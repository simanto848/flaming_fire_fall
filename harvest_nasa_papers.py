#!/usr/bin/env python3
"""
NASA Technical Reports & Literature Harvester for Microgravity Combustion
Queries NASA Technical Reports Server (NTRS) API and NASA publications for:
- BASS / BASS-II (Burning and Suppression of Solids)
- Saffire (Spacecraft Fire Safety Demonstration Projects I-VI)
- FLEX / FLEX-2 (Flame Extinction Experiment, Droplet combustion)
- ACME (Advanced Combustion via Microgravity Experiments)
- Microgravity flame spread, limiting oxygen concentration, radiative extinction, and blowoff.
"""

import urllib.request
import urllib.parse
import json
import time
import os
import sys

SEARCH_QUERIES = [
    # BASS solid combustion
    "BASS microgravity flammability",
    "Burning and Suppression of Solids microgravity",
    "BASS-II PMMA flame spread",
    "solid material flammability microgravity space station",
    # Saffire large scale fire
    "Saffire spacecraft fire safety",
    "Saffire large scale microgravity fire Cygnus",
    "Saffire flame spread fabric PMMA airflow",
    # FLEX droplet combustion & cool flames
    "FLEX flame extinction experiment microgravity",
    "FLEX droplet combustion cool flame CIR",
    "droplet burning rate extinction diameter microgravity",
    # ACME gaseous flames
    "ACME microgravity flame coflow",
    "Advanced Combustion via Microgravity Experiments",
    # Fundamental microgravity flame spread and extinction limits
    "microgravity flame spread extinction limit oxygen",
    "limiting oxygen concentration spacecraft materials microgravity",
    "radiative extinction microgravity flame",
    "blowoff extinction microgravity forced flow",
    "spacecraft atmosphere flammability 34 percent oxygen low pressure",
    "NASA-STD-6001 flammability microgravity correlation"
]

def search_ntrs(query, page_size=25):
    encoded_query = urllib.parse.quote(query)
    url = f"https://ntrs.nasa.gov/api/citations/search?q={encoded_query}&page.size={page_size}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "FlamingFreeFall-RAG/1.0 (NASA Space Apps microgravity research tool)"
    })
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("results", [])
    except Exception as e:
        print(f"Error querying '{query}': {e}", file=sys.stderr)
        return []

def extract_paper_metadata(item):
    citation_id = item.get("id")
    title = item.get("title", "").strip()
    abstract = item.get("abstract", "").strip()
    
    # Authors
    authors = []
    for author in item.get("authorAffiliations", []):
        meta = author.get("meta", {})
        author_name = meta.get("author", {}).get("name")
        if author_name:
            authors.append(author_name)
    
    # Publication / Distribution date
    pub_date = item.get("distributionDate") or item.get("publicationDate") or item.get("created", "")
    if pub_date and "T" in str(pub_date):
        pub_date = pub_date.split("T")[0]
        
    # Report Numbers
    report_numbers = item.get("otherReportNumbers", [])
    casi_id = item.get("id")
    
    # Downloads / Links
    downloads = []
    for d in item.get("downloads", []):
        if "links" in d and "pdf" in d["links"]:
            downloads.append(f"https://ntrs.nasa.gov{d['links']['pdf']}")
            
    nasa_url = f"https://ntrs.nasa.gov/citations/{citation_id}"
    
    # Subject categories & keywords
    keywords = item.get("keywords", [])
    subject_cats = item.get("subjectCategories", [])
    
    # Determine project / experimental focus
    text_corpus = f"{title} {abstract} {' '.join(keywords)}".lower()
    focus = []
    if "bass" in text_corpus:
        focus.append("BASS (Burning and Suppression of Solids)")
    if "saffire" in text_corpus:
        focus.append("Saffire (Spacecraft Fire Safety)")
    if "flex" in text_corpus or "droplet" in text_corpus:
        focus.append("FLEX (Flame Extinction Experiment)")
    if "acme" in text_corpus or "coflow" in text_corpus or "soot" in text_corpus:
        focus.append("ACME (Advanced Combustion via Microgravity)")
    if "radiative extinction" in text_corpus or "radiation" in text_corpus:
        focus.append("Radiative Extinction Limit")
    if "blowoff" in text_corpus or "convective" in text_corpus:
        focus.append("Convective Blowoff Limit")
    if "limiting oxygen" in text_corpus or "loc" in text_corpus or "oxygen concentration" in text_corpus:
        focus.append("Limiting Oxygen Concentration (LOC)")
    if not focus:
        focus.append("Microgravity Combustion Science")

    return {
        "citation_id": citation_id,
        "title": title,
        "authors": authors,
        "publication_date": pub_date,
        "report_numbers": report_numbers,
        "abstract": abstract,
        "keywords": keywords,
        "subject_categories": subject_cats,
        "focus_areas": focus,
        "nasa_url": nasa_url,
        "pdf_urls": downloads,
    }

def main():
    print("=== Commencing NASA Microgravity Combustion Literature Harvesting ===")
    os.makedirs("rag", exist_ok=True)
    
    all_papers = {}
    
    for query in SEARCH_QUERIES:
        print(f"Searching NTRS for: '{query}'...")
        results = search_ntrs(query, page_size=20)
        print(f"  -> Found {len(results)} items")
        for item in results:
            cid = item.get("id")
            if not cid:
                continue
            if cid not in all_papers:
                meta = extract_paper_metadata(item)
                if meta["title"] and meta["abstract"]:
                    all_papers[cid] = meta
        time.sleep(0.5) # Courtesy delay
        
    papers_list = list(all_papers.values())
    print(f"\nTotal unique relevant NASA papers harvested with full abstracts: {len(papers_list)}")
    
    # Save as JSON and JSONL
    json_path = "rag/nasa_microgravity_papers.json"
    jsonl_path = "rag/nasa_microgravity_papers.jsonl"
    
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(papers_list, f, indent=2, ensure_ascii=False)
        
    with open(jsonl_path, "w", encoding="utf-8") as f:
        for p in papers_list:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
            
    print(f"Saved database to {json_path} and {jsonl_path}")
    
    # Generate Markdown Summary Catalog
    md_path = "rag/NASA_Microgravity_Papers_Catalog.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# NASA Microgravity Combustion & Spacecraft Fire Safety Research Papers\n\n")
        f.write(f"Harvested from NASA Technical Reports Server (NTRS) and NASA Open Science portals.\n")
        f.write(f"Total Papers Cataloged: **{len(papers_list)}**\n\n")
        f.write("| Report ID | Title | Key Focus | Authors | Date | Link |\n")
        f.write("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
        
        for p in papers_list:
            rep_str = p['report_numbers'][0] if p['report_numbers'] else p['citation_id']
            authors_str = ", ".join(p['authors'][:2]) + (" et al." if len(p['authors']) > 2 else "")
            focus_str = ", ".join(p['focus_areas'][:2])
            f.write(f"| `{rep_str}` | **{p['title']}** | {focus_str} | {authors_str} | {p['publication_date']} | [NTRS Record]({p['nasa_url']}) |\n")
            
    print(f"Generated Markdown catalog at {md_path}")

if __name__ == "__main__":
    main()

