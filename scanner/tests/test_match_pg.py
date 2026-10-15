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


def test_match_pg_flags_published_after_1930(tmp_path: Path):
    candidates_csv = tmp_path / "candidates.csv"
    catalog_csv = tmp_path / "pg_catalog.csv"
    output_csv = tmp_path / "shortlist.csv"

    candidates_csv.write_text(
        "title,author,first_published_year,ban_country,ban_year,ban_authority,ban_scope,ban_source_url\n"
        "Brave New World,Aldous Huxley,1932,IE,1932,Censorship Board,national,https://example.com/ban\n",
        encoding="utf-8",
    )
    catalog_csv.write_text(
        "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n"
        "99999,Text,2020-01-01,Brave New World,en,\"Huxley, Aldous, 1894-1963\",Dystopian,PR,\n",
        encoding="utf-8",
    )

    match_catalog(candidates_csv, catalog_csv, output_csv)

    with output_csv.open("r", encoding="utf-8") as f:
        reader = list(csv.DictReader(f))
    assert reader[0]["pd_ok"] == "false"
    assert "1930" in reader[0]["pd_reason"] or "1963" in reader[0]["pd_reason"]


def test_match_pg_non_latin_and_special_names():
    # Non-Latin / Chinese author and title transliteration
    entries = parse_authors("Cao, Xueqin, 1715?-1763; Joly, H. Bencraft, -1898, translator")
    assert len(entries) == 2
    assert entries[0]["death_year"] == 1763
    assert entries[1]["death_year"] == 1898
    assert entries[1]["is_translator"] is True

    # Russian author with title/epithet
    tolstoy = parse_authors("Tolstoy, Leo, graf, 1828-1910")
    assert tolstoy[0]["name"] == "Leo Tolstoy"
    assert tolstoy[0]["death_year"] == 1910


def test_match_pg_cli(tmp_path: Path, monkeypatch, capsys):
    from ingest.match_pg import main

    cand = tmp_path / "cand.csv"
    cat = tmp_path / "cat.csv"
    out = tmp_path / "out.csv"

    # Missing file returns 1
    assert main([str(tmp_path / "nonexistent.csv"), str(cat), "--output", str(out)]) == 1
    captured = capsys.readouterr()
    assert "Candidates file not found" in captured.err

    cand.write_text(
        "title,author,first_published_year,ban_country,ban_year,ban_authority,ban_scope,ban_source_url\n"
        "Candide,Voltaire,1759,US,1929,US Customs,import,https://example.com/ban\n",
        encoding="utf-8",
    )
    assert main([str(cand), str(tmp_path / "nonexistent.csv"), "--output", str(out)]) == 1
    captured = capsys.readouterr()
    assert "Gutenberg catalog file not found" in captured.err

    cat.write_text(
        "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n"
        "19942,Text,2006-11-27,Candide,en,\"Voltaire, 1694-1778; Smollett, T. (Tobias), 1721-1771, translator\",Satire,PQ,\n",
        encoding="utf-8",
    )
    assert main([str(cand), str(cat), "--output", str(out)]) == 0
    assert out.is_file()
    captured = capsys.readouterr()
    assert "19942" in captured.out
    assert "[OK]" in captured.out
