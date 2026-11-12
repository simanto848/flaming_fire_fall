#!/usr/bin/env python3
"""
Full-Text PDF Harvester and Chunker for NASA Microgravity Combustion Papers
Downloads and extracts the complete text of all accessible NASA Technical Reports PDFs.
Chunks text into semantically coherent passages tagged with Report ID, Title, Page, and Authors.
"""

import os
import json
import io
import time
import urllib.request
import pypdf
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

def clean_text(text):
    # Normalize whitespaces while preserving paragraphs
    lines = [line.strip() for line in text.splitlines()]
    clean = "\n".join([line for line in lines if line])
    # Remove hyphenated linebreaks
    clean = re.sub(r'(\w+)-\n(\w+)', r'\1\2', clean)
    return clean

def chunk_page_text(page_text, chunk_size=800, overlap=150):
    words = page_text.split()
    if not words:
        return []
    chunks = []
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunk_str = " ".join(chunk_words)
        if len(chunk_str.strip()) > 80: # Filter trivial fragments
            chunks.append(chunk_str)
        i += (chunk_size - overlap)
    return chunks

def download_and_extract_pdf(paper, cache_dir="rag/pdf_texts"):
    cid = paper.get("citation_id")
    title = paper.get("title", "")
    pdf_urls = paper.get("pdf_urls", [])
    rep_id = paper.get("report_numbers", [cid])[0] if paper.get("report_numbers") else cid
    
    txt_cache_path = os.path.join(cache_dir, f"{cid}.txt")
    
    # If already cached locally, read from disk
    if os.path.exists(txt_cache_path):
        with open(txt_cache_path, "r", encoding="utf-8") as f:
            full_text = f.read()
        return cid, rep_id, title, full_text, "cached"
        
    if not pdf_urls:
        # Use abstract as fallback
        full_text = f"Title: {title}\nAbstract: {paper.get('abstract', '')}"
        with open(txt_cache_path, "w", encoding="utf-8") as f:
            f.write(full_text)
        return cid, rep_id, title, full_text, "abstract_only"
        
    pdf_url = pdf_urls[0]
    req = urllib.request.Request(pdf_url, headers={
        "User-Agent": "FlamingFreeFall-RAG/1.0 (NASA Research Study)"
    })
    
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            pdf_bytes = resp.read()
            
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        pages_text = []
        for p_idx, page in enumerate(reader.pages):
            try:
                p_txt = page.extract_text() or ""
                p_txt_clean = clean_text(p_txt)
                if p_txt_clean:
                    pages_text.append(f"--- [Page {p_idx+1}] ---\n{p_txt_clean}")
            except Exception:
                continue
                
        full_text = "\n\n".join(pages_text)
        if not full_text.strip():
            full_text = f"Title: {title}\nAbstract: {paper.get('abstract', '')}"
            
        with open(txt_cache_path, "w", encoding="utf-8") as f:
            f.write(full_text)
            
        return cid, rep_id, title, full_text, "downloaded"
    except Exception as e:
        # Fallback to abstract
        full_text = f"Title: {title}\nAbstract: {paper.get('abstract', '')}\n[PDF fetch failed: {e}]"
        with open(txt_cache_path, "w", encoding="utf-8") as f:
            f.write(full_text)
        return cid, rep_id, title, full_text, f"failed: {e}"

def process_all_papers():
    papers_path = "rag/nasa_microgravity_papers.json"
    cache_dir = "rag/pdf_texts"
    os.makedirs(cache_dir, exist_ok=True)
    
    with open(papers_path, "r", encoding="utf-8") as f:
        papers = json.load(f)
        
    print(f"=== Starting Full-Text Ingestion for {len(papers)} NASA Papers ===")
    
    all_chunks = []
    success_count = 0
    
    # Run with ThreadPoolExecutor for concurrent download
    with ThreadPoolExecutor(max_workers=6) as executor:
        future_to_paper = {executor.submit(download_and_extract_pdf, p, cache_dir): p for p in papers}
        for future in as_completed(future_to_paper):
            paper = future_to_paper[future]
            cid = paper.get("citation_id")
            rep_id = paper.get("report_numbers", [cid])[0] if paper.get("report_numbers") else cid
            try:
                cid, rep_id, title, full_text, status = future.result()
                print(f"[{status.upper():<12}] {rep_id}: {title[:55]}... ({len(full_text)} chars)")
                
                # Split into passages / chunks
                pages = full_text.split("--- [Page ")
                for page_block in pages:
                    if not page_block.strip():
                        continue
                    # Extract page number if present
                    page_num = 1
                    match = re.match(r"^(\d+)\] ---", page_block)
                    if match:
                        page_num = int(match.group(1))
                        page_content = page_block[match.end():]
                    else:
                        page_content = page_block
                        
                    page_chunks = chunk_page_text(page_content, chunk_size=350, overlap=60)
                    for c_idx, c_text in enumerate(page_chunks):
                        all_chunks.append({
                            "chunk_id": f"{cid}_p{page_num}_c{c_idx+1}",
                            "citation_id": cid,
                            "report_id": rep_id,
                            "title": title,
                            "authors": paper.get("authors", []),
                            "publication_date": paper.get("publication_date", ""),
                            "focus_areas": paper.get("focus_areas", []),
                            "nasa_url": paper.get("nasa_url", ""),
                            "page_num": page_num,
                            "text": c_text
                        })
                success_count += 1
            except Exception as exc:
                print(f"[ERROR] {cid}: {exc}")
                
    chunks_path = "rag/nasa_full_text_chunks.jsonl"
    with open(chunks_path, "w", encoding="utf-8") as f:
        for ch in all_chunks:
            f.write(json.dumps(ch, ensure_ascii=False) + "\n")
            
    print(f"\n✅ Completed Full-Text Ingestion!")
    print(f"Total Papers Processed: {success_count}/{len(papers)}")
    print(f"Total Full-Text Chunks Extracted: {len(all_chunks)}")
    print(f"Saved full-text chunks to: {chunks_path}")
    print(f"Cached raw paper texts in: {cache_dir}/")

if __name__ == "__main__":
    process_all_papers()

