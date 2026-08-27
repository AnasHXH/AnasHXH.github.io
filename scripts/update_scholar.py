#!/usr/bin/env python3
"""Refresh Scholar metrics and normalized publication metadata without deleting a good cache on failure."""
from __future__ import annotations

import json
import os
import re
import sys
from difflib import SequenceMatcher
from datetime import datetime, timezone
from pathlib import Path

import httpx
from scholarly import ProxyGenerator, scholarly

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "scholar_data.json"
AUTHOR_ID = os.environ.get("GOOGLE_SCHOLAR_ID", "eBVRL_gAAAAJ")


def fetch(use_proxy: bool = False) -> dict:
    scholarly.set_timeout(20)
    scholarly.set_retries(1)
    if use_proxy:
        proxy = ProxyGenerator()
        if not proxy.FreeProxies():
            raise RuntimeError("No working free proxy")
        scholarly.use_proxy(proxy)
    author = scholarly.search_author_id(AUTHOR_ID)
    return scholarly.fill(author, sections=["basics", "indices", "counts", "publications"])


def normalized_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def cached_records() -> dict[str, dict]:
    try:
        current = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        normalized_title(record.get("title", "")): record
        for record in current.get("publications", [])
        if record.get("title")
    }


def first_value(bib: dict, *keys: str) -> str:
    for key in keys:
        value = bib.get(key)
        if isinstance(value, list):
            value = ", ".join(str(item) for item in value if item)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def classify(title: str, bib: dict, cached: dict) -> str:
    raw = first_value(bib, "pub_type", "type")
    venue = first_value(bib, "citation", "venue", "journal", "conference", "booktitle", "publisher")
    combined = f"{raw} {venue}".lower()
    cached_type = str(cached.get("type", ""))
    if cached_type and cached_type.lower() != "publication":
        return cached_type
    if re.search(r"chapter|book section|book chapter", combined):
        return "Chapter"
    if re.search(r"preprint|arxiv|biorxiv|medrxiv", combined):
        return "Preprint"
    if re.search(r"conference|proceedings|workshop|symposium", combined) or re.search(r"\bntire\b", title, re.I):
        return "Conference Paper"
    return "Article"


def openalex_metadata(client: httpx.Client, title: str) -> dict:
    response = client.get(
        "https://api.openalex.org/works",
        params={
            "search": title,
            "per-page": 5,
            "select": "display_name,authorships,primary_location,doi,type",
        },
    )
    response.raise_for_status()
    candidates = response.json().get("results", [])
    target = normalized_title(title)
    if not candidates:
        return {}
    best = max(
        candidates,
        key=lambda work: SequenceMatcher(None, target, normalized_title(work.get("display_name", ""))).ratio(),
    )
    score = SequenceMatcher(None, target, normalized_title(best.get("display_name", ""))).ratio()
    if score < 0.86:
        return {}
    authors = [
        item.get("author", {}).get("display_name")
        for item in best.get("authorships", [])
        if item.get("author", {}).get("display_name")
    ]
    source = ((best.get("primary_location") or {}).get("source") or {}).get("display_name", "")
    work_type = str(best.get("type") or "").lower()
    type_map = {
        "article": "Article",
        "review": "Article",
        "preprint": "Preprint",
        "book-chapter": "Chapter",
        "proceedings-article": "Conference Paper",
    }
    return {
        "authors": authors,
        "venue": source,
        "doi": str(best.get("doi") or "").removeprefix("https://doi.org/"),
        "type": type_map.get(work_type, ""),
    }


def simplify(author: dict) -> dict:
    previous = cached_records()
    records = []
    openalex_enabled = True
    headers = {"User-Agent": "AnasHXH-academic-portfolio/1.0"}
    with httpx.Client(timeout=12, follow_redirects=True, headers=headers) as client:
        for publication in author.get("publications", []):
            bib = publication.get("bib", {})
            title = first_value(bib, "title")
            if not title:
                continue
            cached = previous.get(normalized_title(title), {})
            raw_year = bib.get("pub_year") or bib.get("year") or cached.get("year")
            try:
                year = int(raw_year)
            except (TypeError, ValueError):
                year = None
            author_pub_id = publication.get("author_pub_id")
            scholar_url = None
            if author_pub_id:
                scholar_url = (
                    "https://scholar.google.com/citations?view_op=view_citation&hl=en"
                    f"&user={AUTHOR_ID}&citation_for_view={author_pub_id}"
                )
            authors = first_value(bib, "author", "authors") or cached.get("authors", "")
            venue = first_value(bib, "citation", "venue", "journal", "conference", "booktitle", "publisher") or cached.get("venue", "")
            doi = first_value(bib, "doi") or cached.get("doi", "")
            metadata = {}
            if openalex_enabled and (not authors or not venue or not doi):
                try:
                    metadata = openalex_metadata(client, title)
                except (httpx.HTTPError, ValueError):
                    openalex_enabled = False
            authors = authors or metadata.get("authors", [])
            venue = venue or metadata.get("venue", "")
            doi = doi or metadata.get("doi", "")
            publication_type = classify(title, bib, cached)
            if publication_type == "Article" and metadata.get("type"):
                publication_type = metadata["type"]
            records.append({
                "title": title,
                "authors": authors,
                "year": year,
                "type": publication_type,
                "venue": venue,
                "doi": doi,
                "citedby": publication.get("num_citations", cached.get("citedby", 0)),
                "url": scholar_url or cached.get("url"),
            })
    records.sort(key=lambda item: (item.get("year") or 0, item.get("citedby") or 0), reverse=True)
    return {
        "source": "Google Scholar",
        "author_id": AUTHOR_ID,
        "updated": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "publications": len(records),
            "citations": author.get("citedby", 0),
            "hindex": author.get("hindex", 0),
            "i10index": author.get("i10index", 0),
        },
        "publications": records,
    }


def main() -> int:
    errors = []
    for use_proxy in (False, True):
        try:
            data = simplify(fetch(use_proxy))
            if not data["publications"] or not data["metrics"]["hindex"]:
                raise RuntimeError("Scholar returned incomplete data")
            OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"Updated {OUTPUT.name} with {len(data['publications'])} publications")
            return 0
        except Exception as exc:  # Scholar frequently rate-limits cloud runners.
            errors.append(f"{'proxy' if use_proxy else 'direct'}: {exc}")
    print("Scholar refresh skipped; preserving the existing cache.", file=sys.stderr)
    print(" | ".join(errors), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
