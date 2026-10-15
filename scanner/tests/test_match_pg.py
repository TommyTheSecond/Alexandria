"""Tests for ingest/match_pg.py (A3 task T3)."""

import csv
from pathlib import Path

from ingest.match_pg import (
    match_catalog,
    parse_author_entry,
    parse_authors,
)


def test_match_pg_parses_years():
    # Standard author with birth and death years
    authors = parse_authors("Twain, Mark, 1835-1910")
    assert len(authors) == 1
    assert authors[0]["name"] == "Mark Twain"
    assert authors[0]["birth_year"] == 1835
    assert authors[0]["death_year"] == 1910
    assert authors[0]["is_translator"] is False

    # Author with -death format
    single = parse_author_entry("Joly, H. Bencraft (Henry Bencraft), -1898, translator")
    assert single["death_year"] == 1898
    assert single["is_translator"] is True

    # Multiple entries separated by semicolon
    multi = parse_authors(
        "Tolstoy, Leo, graf, 1828-1910; Garnett, Constance, 1861-1946, translator"
    )
    assert len(multi) == 2
    assert multi[0]["death_year"] == 1910
    assert multi[0]["is_translator"] is False
    assert multi[1]["death_year"] == 1946
    assert multi[1]["is_translator"] is True


def test_match_pg_flags_translator_after_1955(tmp_path: Path):
    candidates_csv = tmp_path / "candidates.csv"
    catalog_csv = tmp_path / "pg_catalog.csv"
    output_csv = tmp_path / "shortlist.csv"

    # Candidate published <= 1930
    candidates_csv.write_text(
        "title,author,first_published_year,ban_country,ban_year,ban_authority,ban_scope,ban_source_url\n"
        "The Metamorphosis,Franz Kafka,1915,DE,1933,Reich Chamber of Literature,national,https://example.com/ban\n",
        encoding="utf-8",
    )

    # Catalog row with translator who died in 1968 (> 1955)
    catalog_csv.write_text(
        "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n"
        "5200,Text,2004-05-01,The Metamorphosis,en,\"Kafka, Franz, 1883-1924; Muir, Willa, 1890-1970, translator; Muir, Edwin, 1887-1959, translator\",Fiction,PT,\n",
        encoding="utf-8",
    )

    match_catalog(candidates_csv, catalog_csv, output_csv)

    assert output_csv.exists()
    with output_csv.open("r", encoding="utf-8") as f:
        reader = list(csv.DictReader(f))
    assert len(reader) == 1
    row = reader[0]
    assert row["gutenberg_id"] == "5200"
    assert row["pd_ok"].lower() in ("false", "0", "no")
    assert "1955" in row["pd_reason"] or "1959" in row["pd_reason"] or "1970" in row["pd_reason"]


def test_match_pg_approves_valid_pd_book(tmp_path: Path):
    candidates_csv = tmp_path / "candidates.csv"
    catalog_csv = tmp_path / "pg_catalog.csv"
    output_csv = tmp_path / "shortlist.csv"

    candidates_csv.write_text(
        "title,author,first_published_year,ban_country,ban_year,ban_authority,ban_scope,ban_source_url\n"
        "Adventures of Huckleberry Finn,Mark Twain,1884,US,1885,Concord Public Library,library,https://example.com/ban\n",
        encoding="utf-8",
    )

    catalog_csv.write_text(
        "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n"
        "76,Text,2006-04-06,Adventures of Huckleberry Finn,en,\"Twain, Mark, 1835-1910\",Humor; Mississippi River,PS,\n",
        encoding="utf-8",
    )

    match_catalog(candidates_csv, catalog_csv, output_csv)

    assert output_csv.exists()
    with output_csv.open("r", encoding="utf-8") as f:
        reader = list(csv.DictReader(f))
    assert len(reader) == 1
    row = reader[0]
    assert row["gutenberg_id"] == "76"
    assert row["pd_ok"].lower() in ("true", "1", "yes")
