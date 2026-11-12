#!/usr/bin/env python3
"""
ShunnoShikha AI - Live NASA Web RAG Engine
Retrieval-Augmented Generation directly from NASA's live websites:
- NASA Physical Science Informatics (PSI) investigation pages (psi.nasa.gov)
- NASA Technical Reports Server (NTRS) public search API (live citations + abstracts)
- NASA Glenn microgravity combustion research pages

Design: pages are fetched ON DEMAND per query (with a 24h disk cache to avoid
hammering NASA servers). No bulk paper/PDF corpus is downloaded. Every retrieved
passage carries its live source URL and fetch timestamp for provenance.
"""

import os
import re
import json
import math
import time
import hashlib
import logging
from collections import Counter
from typing import Dict, List, Any, Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("shunnoshikha.live_rag")

CACHE_DIR = "data/web_rag_cache"
CACHE_TTL_SECONDS = 24 * 3600
NTRS_SEARCH_URL = "https://ntrs.nasa.gov/api/citations/search"
NTRS_CITATION_URL = "https://ntrs.nasa.gov/citations/{id}"
PSI_SEARCH_URL = "https://psi.nasa.gov/geode-py/ws/repo/search"
PSI_INVESTIGATION_URL = "https://psi.nasa.gov/physci/repo/data/investigations/{acc}"
USER_AGENT = "ShunnoShikhaAI/2.0 (NASA Space Apps - Flame in Freefall; scientific research)"

# Verified live NASA sources. Topic keywords drive on-demand source selection.
SEED_SOURCES: List[Dict[str, Any]] = [
    {
        "id": "psi-portal",
        "title": "NASA Physical Science Informatics (PSI) Repository",
        "url": "https://psi.nasa.gov/",
        "topics": ["psi", "physical science", "informatics", "repository", "data", "investigation"],
    },
    {
        "id": "grc-iss-combustion",
        "title": "NASA Glenn ISS Combustion Science Research",
        "url": "https://www1.grc.nasa.gov/space/iss-research/",
        "topics": ["combustion", "iss", "microgravity", "flame", "fire", "research", "bass", "flex", "acme", "saffire"],
    },
    {
        "id": "grc-msg",
        "title": "NASA Microgravity Science Glovebox (MSG) — BASS Flight Facility",
        "url": "https://www1.grc.nasa.gov/space/iss-research/msg/",
        "topics": ["glovebox", "msg", "bass", "solid", "flammability", "facility", "suppression"],
    },
]


def _cache_path(url: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, hashlib.sha1(url.encode()).hexdigest() + ".json")


def extract_main_text(html: str, url: str) -> Dict[str, str]:
    """Parses HTML and extracts title + main readable text (no scripts/nav boilerplate)."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "form", "iframe"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else url
    main = soup.find("main") or soup.find("article") or soup.find(id=re.compile("content|main", re.I)) or soup.body or soup
    text = main.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return {"title": title, "text": text}


def chunk_text(text: str, chunk_size: int = 700, overlap: int = 120) -> List[str]:
    """Splits text into overlapping passages on paragraph boundaries."""
    paragraphs = [p.strip() for p in text.split("\n") if len(p.strip()) > 40]
    chunks: List[str] = []
    current = ""
    for p in paragraphs:
        if len(current) + len(p) + 1 <= chunk_size:
            current = f"{current}\n{p}".strip()
        else:
            if current:
                chunks.append(current)
            if len(p) > chunk_size:
                words = p.split()
                buf = ""
                for w in words:
                    if len(buf) + len(w) + 1 > chunk_size:
                        chunks.append(buf)
                        buf = buf[-overlap:] + " " + w if overlap else w
                    else:
                        buf = f"{buf} {w}".strip()
                current = buf
            else:
                current = p
    if current:
        chunks.append(current)
    return [c for c in chunks if len(c) > 60]


class LiveWebRAG:
    """On-demand live retrieval from NASA websites with BM25 ranking + provenance."""

    def __init__(self, extra_sources: Optional[List[Dict[str, Any]]] = None):
        self.sources = list(SEED_SOURCES) + (extra_sources or [])
        self.passages: List[Dict[str, Any]] = []
        self._indexed_urls: set = set()
        self._passage_keys: set = set()
        self._vocab: Dict[str, int] = {}
        self._idf: Dict[str, float] = {}
        self._vectors: List[Dict[str, float]] = []
        self.fetch_log: List[Dict[str, Any]] = []
        self._verified_urls: set = set()

    # ---------------- live fetching ----------------
    def fetch_page(self, url: str, force: bool = False) -> Dict[str, Any]:
        """Fetches a live NASA page (24h disk cache). Returns title/text/fetched_at."""
        path = _cache_path(url)
        if not force and os.path.exists(path):
            try:
                cached = json.load(open(path, encoding="utf-8"))
                if time.time() - cached.get("fetched_at", 0) < CACHE_TTL_SECONDS:
                    if cached.get("url"):
                        self._verified_urls.add(cached["url"])
                    return cached
            except Exception:
                pass
        with httpx.Client(timeout=30.0, follow_redirects=True, trust_env=False, headers={"User-Agent": USER_AGENT}) as client:
            r = client.get(url)
            r.raise_for_status()
            parsed = extract_main_text(r.text, url)
        doc = {
            "url": str(r.url),
            "title": parsed["title"],
            "text": parsed["text"],
            "fetched_at": time.time(),
            "fetch_mode": "LIVE",
        }
        self._verified_urls.add(doc["url"])
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f)
        except Exception as exc:
            logger.warning("cache write failed: %s", exc)
        self.fetch_log.append({"url": doc["url"], "title": doc["title"], "chars": len(doc["text"]), "at": doc["fetched_at"]})
        return doc

    def verify_url(self, url: str) -> Optional[str]:
        """Return the final URL only when the public NASA page is reachable now."""
        if not url.startswith("https://"):
            return None
        try:
            with httpx.Client(
                timeout=12.0,
                follow_redirects=True,
                trust_env=False,
                headers={"User-Agent": USER_AGENT},
            ) as client:
                response = client.get(url, headers={"Range": "bytes=0-4095"})
                response.raise_for_status()
            final_url = str(response.url)
            self._verified_urls.add(final_url)
            return final_url
        except Exception as exc:
            logger.warning("NASA source verification failed for %s: %s", url, exc)
            return None

    def sanitize_citations(self, answer: str) -> str:
        """Remove links not returned by a successful live NASA verification."""
        allowed = self._verified_urls

        def replace_markdown(match: re.Match[str]) -> str:
            label, url = match.group(1), match.group(2)
            return match.group(0) if url in allowed else label

        answer = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", replace_markdown, answer)

        def replace_bare(match: re.Match[str]) -> str:
            url = match.group(0).rstrip(".,;)")
            return url if url in allowed else ""

        return re.sub(r"https?://[^\s)]+", replace_bare, answer)

    def search_ntrs(self, query: str, size: int = 6) -> List[Dict[str, Any]]:
        """Live NTRS citation search — returns metadata + abstracts without downloading papers."""
        results: List[Dict[str, Any]] = []
        # NTRS full-text search ranks better with content keywords than natural-language questions.
        stop = {"what", "which", "how", "why", "when", "does", "did", "do", "is", "are", "the", "a", "an",
                "of", "in", "on", "for", "to", "and", "or", "about", "reveal", "reveals", "show", "shows",
                "tell", "me", "explain", "nasa", "experiments", "experiment", "research", "study", "studies"}
        words = [w for w in re.sub(r"[^a-zA-Z0-9\- ]", " ", query.lower()).split() if w and w not in stop]
        kw_query = " ".join(words[:8]) if len(words) > 8 else " ".join(words) or query
        try:
            with httpx.Client(timeout=30.0, trust_env=False, headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"}) as client:
                r = client.post(NTRS_SEARCH_URL, json={"q": kw_query, "page": {"size": size, "number": 0}})
                if r.status_code != 200:
                    r = client.get(NTRS_SEARCH_URL, params={"q": kw_query, "size": size})
                r.raise_for_status()
                data = r.json()
            hits = data.get("results") or data.get("citations") or data.get("hits") or []
            if isinstance(hits, dict):
                hits = hits.get("hits", [])
            for h in hits[:size]:
                cid = str(h.get("id") or h.get("citationId") or "")
                if not cid:
                    continue
                authors = []
                for aff in (h.get("authorAffiliations") or []):
                    name = (aff.get("meta") or {}).get("author", {}).get("name")
                    if name:
                        authors.append(name)
                if not authors:
                    authors = [a.get("name", "") if isinstance(a, dict) else str(a) for a in (h.get("authors") or [])]
                results.append({
                    "id": cid,
                    "title": h.get("title", ""),
                    "abstract": h.get("abstract") or h.get("description") or "",
                    "authors": authors[:6],
                    "publication_date": h.get("submittedDate") or h.get("created") or "",
                    "url": NTRS_CITATION_URL.format(id=cid),
                    "source": "NTRS_LIVE_API",
                })
        except Exception as exc:
            logger.warning("NTRS live search failed: %s", exc)
        return results

    def search_psi(self, query: str, size: int = 6) -> List[Dict[str, Any]]:
        """Live NASA PSI repository search — returns real investigation metadata
        (objectives, approach, hypothesis, hardware, publications) as RAG passages."""
        results: List[Dict[str, Any]] = []
        try:
            with httpx.Client(timeout=30.0, trust_env=False, headers={"User-Agent": USER_AGENT}) as client:
                r = client.get(PSI_SEARCH_URL, params={"q": query, "size": size * 3})
                r.raise_for_status()
                hits = r.json().get("hits", {}).get("hits", [])
            for h in hits:
                s = h.get("_source", {})
                acc = s.get("Accession", "")
                if not acc.startswith("PSI"):
                    continue
                # Keep only combustion / fire-science investigations (PSI fuzzy search
                # otherwise returns unrelated colloids / materials studies).
                blob = f"{s.get('Title','')} {s.get('Keywords','')} {s.get('Acronym','')}".lower()
                if not any(k in blob for k in ["flame", "burn", "combust", "fire", "flamm", "soot",
                                                "ignition", "extinction", "cool flame", "smolder", "droplet"]):
                    continue
                parts = [f"{acc}: {s.get('Title', '')}."]
                for field in ["Acronym", "Flight Platform", "Objectives", "Approach", "Hypothesis", "Keywords"]:
                    val = s.get(field)
                    if val:
                        parts.append(f"{field}: {str(val).strip()}")
                hardware = s.get("Experiment Hardware")
                if isinstance(hardware, dict) and hardware.get("Name"):
                    parts.append(f"Experiment Hardware: {hardware['Name']}")
                pub = s.get("Publication Title")
                if pub:
                    parts.append(f"Publications: {str(pub)[:500]}")
                results.append({
                    "accession": acc,
                    "title": s.get("Title", ""),
                    "text": "\n".join(parts),
                    "url": PSI_INVESTIGATION_URL.format(acc=acc),
                    "project_type": s.get("Project Type", ""),
                    "source": "PSI_LIVE_API",
                })
                if len(results) >= size:
                    break
        except Exception as exc:
            logger.warning("PSI live search failed: %s", exc)
        return results

    # ---------------- indexing ----------------
    def _tokenize(self, text: str) -> List[str]:
        return [t for t in re.sub(r"[^a-zA-Z0-9\-\.]", " ", text.lower()).split() if len(t) > 1]

    def _add_passages(self, new_passages: List[Dict[str, Any]]):
        # Dedup: repeated queries must not accumulate identical passages.
        unique = []
        for p in new_passages:
            key = (p.get("source_id"), p.get("chunk_num"), p.get("text", "")[:200])
            if key in self._passage_keys:
                continue
            self._passage_keys.add(key)
            unique.append(p)
        if not unique:
            return
        self.passages.extend(unique)
        N = len(self.passages)
        df_counts: Counter = Counter()
        tokens_list = []
        for p in self.passages:
            toks = self._tokenize(p["text"])
            tokens_list.append(toks)
            df_counts.update(set(toks))
        self._vocab = {t: i for i, t in enumerate(df_counts)}
        self._idf = {t: math.log(1.0 + (N - c + 0.5) / (c + 0.5)) for t, c in df_counts.items()}
        k1, b = 1.5, 0.75
        lens = [len(t) for t in tokens_list]
        avg = sum(lens) / max(1, N)
        self._vectors = []
        for toks, dl in zip(tokens_list, lens):
            tf = Counter(toks)
            self._vectors.append({
                t: self._idf[t] * (c * (k1 + 1.0)) / (c + k1 * (1.0 - b + b * dl / avg))
                for t, c in tf.items() if t in self._idf
            })

    def _select_sources(self, query: str) -> List[Dict[str, Any]]:
        q_tokens = set(self._tokenize(query))
        scored = []
        for s in self.sources:
            overlap = len(q_tokens & set(s["topics"]))
            scored.append((overlap, s))
        scored.sort(key=lambda x: -x[0])
        selected = [s for ov, s in scored if ov > 0][:4]
        return selected or [s for _, s in scored[:2]]

    # ---------------- retrieval ----------------
    def retrieve(self, query: str, top_k: int = 6, include_ntrs: bool = True) -> Dict[str, Any]:
        """
        Live retrieval pipeline:
        1. Select topic-matched NASA seed pages, fetch live (cached 24h)
        2. Query NTRS search API live for peer-reviewed citations + abstracts
        3. Chunk everything, BM25-rank, return passages with provenance URLs
        """
        new_passages: List[Dict[str, Any]] = []
        fetch_errors: List[str] = []

        for src in self._select_sources(query):
            if src["url"] in self._indexed_urls:
                continue
            try:
                doc = self.fetch_page(src["url"])
                self._indexed_urls.add(src["url"])
                for i, ch in enumerate(chunk_text(doc["text"])):
                    new_passages.append({
                        "text": ch,
                        "title": doc["title"],
                        "url": doc["url"],
                        "source_id": src["id"],
                        "source_type": "NASA_LIVE_PAGE",
                        "fetched_at": doc["fetched_at"],
                        "chunk_num": i,
                    })
            except Exception as exc:
                fetch_errors.append(f"{src['url']}: {exc}")

        ntrs_results: List[Dict[str, Any]] = []
        psi_results: List[Dict[str, Any]] = []
        if include_ntrs:
            psi_results = self.search_psi(query, size=4)
            for hit in psi_results:
                verified_url = self.verify_url(hit["url"])
                if not verified_url:
                    fetch_errors.append(f"{hit['url']}: source page could not be verified")
                    continue
                hit["url"] = verified_url
                for i, ch in enumerate(chunk_text(hit["text"])):
                    new_passages.append({
                        "text": ch,
                        "title": f"{hit['accession']} — {hit['title']}",
                        "url": hit["url"],
                        "source_id": hit["accession"],
                        "source_type": "PSI_LIVE_API",
                        "fetched_at": time.time(),
                        "chunk_num": i,
                    })
            ntrs_results = self.search_ntrs(query, size=6)
            for hit in ntrs_results:
                verified_url = self.verify_url(hit["url"])
                if not verified_url:
                    fetch_errors.append(f"{hit['url']}: source page could not be verified")
                    continue
                hit["url"] = verified_url
                text = f"{hit['title']}. {hit['abstract']}"
                if len(text) > 80:
                    new_passages.append({
                        "text": text[:1600],
                        "title": hit["title"],
                        "url": hit["url"],
                        "source_id": hit["id"],
                        "source_type": "NTRS_LIVE_API",
                        "fetched_at": time.time(),
                        "chunk_num": 0,
                        "authors": hit["authors"],
                        "publication_date": hit["publication_date"],
                    })

        if new_passages:
            self._add_passages(new_passages)

        q_tokens = self._tokenize(query)
        scored = []
        for i, vec in enumerate(self._vectors):
            score = sum(vec.get(t, 0.0) for t in q_tokens)
            if score > 0:
                scored.append((score, self.passages[i]))
        scored.sort(key=lambda x: -x[0])

        top = []
        for score, p in scored[:top_k]:
            verified_url = self.verify_url(p["url"])
            if not verified_url:
                continue
            p = dict(p)
            p["url"] = verified_url
            entry = dict(p)
            entry["score"] = round(float(score), 3)
            entry["fetched_at_iso"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(p["fetched_at"]))
            top.append(entry)

        return {
            "query": query,
            "retrieval_mode": "LIVE_WEB",
            "passages": top,
            "ntrs_citations": ntrs_results,
            "psi_investigations": [{"accession": p["accession"], "title": p["title"], "url": p["url"]} for p in psi_results],
            "indexed_passages_total": len(self.passages),
            "fetch_errors": fetch_errors,
            "verified_sources": [
                {"title": p["title"], "url": p["url"], "fetched_at_iso": p["fetched_at_iso"]}
                for p in top
            ],
        }

    def status(self) -> Dict[str, Any]:
        return {
            "mode": "LIVE_WEB_RAG",
            "seed_sources": [{"id": s["id"], "title": s["title"], "url": s["url"]} for s in self.sources],
            "indexed_passages": len(self.passages),
            "indexed_urls": len(self._indexed_urls),
            "cache_dir": CACHE_DIR,
            "recent_fetches": self.fetch_log[-8:],
        }