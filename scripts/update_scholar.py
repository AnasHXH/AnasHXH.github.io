#!/usr/bin/env python3
"""Refresh cached Scholar metrics/publications without deleting a good cache on failure."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

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


def simplify(author: dict) -> dict:
    records = []
    for publication in author.get("publications", []):
        bib = publication.get("bib", {})
        title = bib.get("title")
        if not title:
            continue
        raw_year = bib.get("pub_year") or bib.get("year")
        try:
            year = int(raw_year)
        except (TypeError, ValueError):
            year = None
        author_pub_id = publication.get("author_pub_id")
        url = None
        if author_pub_id:
            url = (
                "https://scholar.google.com/citations?view_op=view_citation&hl=en"
                f"&user={AUTHOR_ID}&citation_for_view={author_pub_id}"
            )
        records.append({
            "title": title,
            "year": year,
            "type": bib.get("pub_type") or "Publication",
            "venue": bib.get("citation") or bib.get("venue") or "",
            "citedby": publication.get("num_citations", 0),
            "url": url,
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
