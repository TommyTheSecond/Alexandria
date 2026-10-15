"""Text analysis (runs inside the sandbox child) plus text.extract and text.match."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

from .base import ScanCheck, fail, ok

MIN_WORDS = 2000
MATCH_PAGES = 10
MAX_TEXT_CHARS = 2_000_000  # cap what we keep from huge books
WORD_RE = re.compile(r"[^\W_]+")


@dataclass
class TextAnalysis:
    text: str                     # lowercased text of the whole book (capped)
    first_pages: str              # lowercased text of the first MATCH_PAGES pages
    words: list[str] = field(default_factory=list)

    @property
    def word_count(self) -> int:
        return len(self.words)

    @classmethod
    def from_pages(cls, pages: list[str]) -> "TextAnalysis":
        text = "\n".join(pages).lower()[:MAX_TEXT_CHARS]
        first = "\n".join(pages[:MATCH_PAGES]).lower()
        return cls(text=text, first_pages=first, words=WORD_RE.findall(text))


def analyse_text(data: bytes) -> TextAnalysis:
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        pages, total = [], 0
        for page in doc:
            text = page.get_text()
            pages.append(text)
            total += len(text)
            if total > MAX_TEXT_CHARS:
                break
    return TextAnalysis.from_pages(pages)


def text_extract(analysis: TextAnalysis) -> ScanCheck:
    if analysis.word_count >= MIN_WORDS:
        return ok("text.extract", "review", f"{analysis.word_count} words")
    return fail("text.extract", "review",
                f"{analysis.word_count} words extracted; at least {MIN_WORDS} expected (scan without OCR?)")


def _title_tokens(title: str) -> list[str]:
    return [t for t in WORD_RE.findall(title.lower()) if len(t) >= 3 or not t.isascii()]


def text_match(analysis: TextAnalysis, meta: dict) -> ScanCheck:
    title = str(meta.get("title", ""))
    tokens = _title_tokens(title)
    found = [t for t in tokens if t in analysis.first_pages]
    authors = meta.get("authors") if isinstance(meta.get("authors"), list) else []
    name = str(authors[0].get("name", "")) if authors and isinstance(authors[0], dict) else ""
    surname = (WORD_RE.findall(name.lower()) or [""])[-1]
    title_ok = not tokens or len(found) * 2 >= len(tokens)
    author_ok = not surname or surname in analysis.first_pages
    if title_ok and author_ok:
        return ok("text.match", "review", f"title words {len(found)}/{len(tokens)}, author surname found")
    missing = [] if title_ok else [f"title words {len(found)}/{len(tokens)}"]
    if not author_ok:
        missing.append(f"author surname '{surname}' not found")
    return fail("text.match", "review", f"first {MATCH_PAGES} pages: " + "; ".join(missing))
