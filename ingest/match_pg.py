"""Match candidate books against Project Gutenberg's catalog (A3 task T3).

Reads ingest/candidates.csv and pg_catalog.csv, parses author/translator birth-death
years, applies the public-domain rule (published <= 1930, all authors/translators
died <= 1955), and outputs ingest/shortlist.csv with gutenberg_id and pd_ok.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

MAX_FIRST_PUBLISHED = 1930
MAX_DEATH_YEAR = 1955

YEAR_RANGE_RE = re.compile(r"(?<!\d)(\d{3,4})\??\s*[-–—]\s*(\d{3,4})\??(?!\d)")
DEATH_ONLY_RE = re.compile(r"[-–—]\s*(\d{3,4})\??(?!\d)|(?:\bd\.\s*|\bdeath\s*[:\s]*)(\d{3,4})\??(?!\d)", re.I)
BIRTH_ONLY_RE = re.compile(r"(?:\bb\.\s*|\bbirth\s*[:\s]*)(\d{3,4})\??(?!\d)", re.I)


def _normalize_name(raw: str) -> str:
    cleaned = re.sub(YEAR_RANGE_RE, "", raw)
    cleaned = re.sub(DEATH_ONLY_RE, "", cleaned)
    cleaned = re.sub(BIRTH_ONLY_RE, "", cleaned)
    cleaned = re.sub(r"\b(translator|trans|tr|editor|ed|illustrator|ill|annotator|graf|sir|dr)\b\.?", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(",; ")
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    if len(parts) == 2 and not any(p.isdigit() for p in parts):
        return f"{parts[1]} {parts[0]}"
    return cleaned


def parse_author_entry(raw: str) -> Dict[str, Any]:
    text = raw.strip()
    is_translator = bool(re.search(r"\b(translator|trans\.|tr\.)\b", text, re.I))

    birth_year: Optional[int] = None
    death_year: Optional[int] = None

    range_match = YEAR_RANGE_RE.search(text)
    if range_match:
        birth_year = int(range_match.group(1))
        death_year = int(range_match.group(2))
    else:
        death_match = DEATH_ONLY_RE.search(text)
        if death_match:
            death_val = death_match.group(1) or death_match.group(2)
            death_year = int(death_val)
        birth_match = BIRTH_ONLY_RE.search(text)
        if birth_match:
            birth_year = int(birth_match.group(1))

    name = _normalize_name(text)

    return {
        "raw": text,
        "name": name,
        "birth_year": birth_year,
        "death_year": death_year,
        "is_translator": is_translator,
    }


def parse_authors(authors_str: str) -> List[Dict[str, Any]]:
    if not authors_str or not authors_str.strip():
        return []
    entries = [e.strip() for e in authors_str.split(";") if e.strip()]
    return [parse_author_entry(e) for e in entries]


def check_pd_status(
    first_published_year: Optional[int], people: List[Dict[str, Any]]
) -> Tuple[bool, str]:
    if first_published_year is None:
        return False, "missing first_published_year"
    if first_published_year > MAX_FIRST_PUBLISHED:
        return False, f"first published {first_published_year} > {MAX_FIRST_PUBLISHED}"

    for p in people:
        dy = p.get("death_year")
        role = "translator" if p.get("is_translator") else "author"
        name = p.get("name") or "unknown"
        if dy is not None and dy > MAX_DEATH_YEAR:
            return False, f"{role} {name} died {dy} > {MAX_DEATH_YEAR}"

    return True, f"published {first_published_year} <= {MAX_FIRST_PUBLISHED}, all verified deaths <= {MAX_DEATH_YEAR}"


def _normalize_title(title: str) -> str:
    cleaned = title.lower()
    cleaned = re.sub(r"\b(the|a|an)\b", "", cleaned)
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    return " ".join(cleaned.split())


def _normalize_author(author: str) -> str:
    cleaned = author.lower()
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    return " ".join(cleaned.split())


def _author_matches(candidate_author: str, catalog_authors: str) -> bool:
    norm_c = _normalize_author(candidate_author)
    norm_r = _normalize_author(catalog_authors)
    if not norm_c:
        return True
    parts = [p for p in norm_c.split() if len(p) > 2]
    if not parts:
        return True
    return all(part in norm_r for part in parts)


def find_catalog_match(
    candidate_title: str,
    candidate_author: str,
    catalog_rows: List[Dict[str, str]],
) -> Optional[Dict[str, str]]:
    norm_ctitle = _normalize_title(candidate_title)

    exact_matches = []
    partial_matches = []

    for row in catalog_rows:
        row_title = row.get("Title", "")
        row_authors = row.get("Authors", "")
        norm_rtitle = _normalize_title(row_title)

        if not norm_rtitle:
            continue

        if norm_ctitle == norm_rtitle:
            if _author_matches(candidate_author, row_authors):
                exact_matches.append(row)
        elif norm_ctitle in norm_rtitle or norm_rtitle in norm_ctitle:
            if _author_matches(candidate_author, row_authors):
                partial_matches.append(row)

    if exact_matches:
        # Prefer English if multiple
        for m in exact_matches:
            if m.get("Language", "") == "en":
                return m
        return exact_matches[0]

    if partial_matches:
        for m in partial_matches:
            if m.get("Language", "") == "en":
                return m
        return partial_matches[0]

    return None


def match_catalog(
    candidates_csv: Path,
    catalog_csv: Path,
    output_csv: Path,
) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, str]] = []
    with candidates_csv.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            candidates.append(r)

    catalog_rows: List[Dict[str, str]] = []
    with catalog_csv.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            catalog_rows.append(r)

    results: List[Dict[str, Any]] = []

    for cand in candidates:
        title = cand.get("title", "").strip()
        author = cand.get("author", "").strip()
        pub_year_str = cand.get("first_published_year", "").strip()
        pub_year = int(pub_year_str) if pub_year_str.isdigit() else None

        match = find_catalog_match(title, author, catalog_rows)
        gutenberg_id = match.get("Text#", "") if match else ""
        catalog_authors_str = match.get("Authors", "") if match else ""

        people = parse_authors(catalog_authors_str)
        pd_ok, reason = check_pd_status(pub_year, people)

        row_dict = dict(cand)
        row_dict["gutenberg_id"] = gutenberg_id
        row_dict["pd_ok"] = "true" if pd_ok else "false"
        row_dict["pd_reason"] = reason
        results.append(row_dict)

    fieldnames = list(candidates[0].keys()) if candidates else []
    for extra in ("gutenberg_id", "pd_ok", "pd_reason"):
        if extra not in fieldnames:
            fieldnames.append(extra)

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    return results


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Match candidates against pg_catalog.csv")
    parser.add_argument("candidates", type=Path, nargs="?", default=Path("ingest/candidates.csv"),
                        help="Path to candidates.csv")
    parser.add_argument("catalog", type=Path, nargs="?", default=Path("pg_catalog.csv"),
                        help="Path to pg_catalog.csv")
    parser.add_argument("--output", type=Path, default=Path("ingest/shortlist.csv"),
                        help="Path to output shortlist.csv")
    args = parser.parse_args(argv)

    if not args.candidates.is_file():
        print(f"Candidates file not found: {args.candidates}", file=sys.stderr)
        return 1
    if not args.catalog.is_file():
        print(f"Gutenberg catalog file not found: {args.catalog}", file=sys.stderr)
        return 1

    matched = match_catalog(args.candidates, args.catalog, args.output)
    print(f"Matched {len(matched)} candidates -> {args.output}")
    for m in matched:
        print(f"  [{'OK' if m['pd_ok'] == 'true' else 'FAIL'}] {m.get('title')} (ID: {m.get('gutenberg_id')}) - {m.get('pd_reason')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
