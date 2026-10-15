"""spam.urls, spam.repeat, spam.keywords."""

from __future__ import annotations

import re
import zlib
from functools import lru_cache
from pathlib import Path

from .base import ScanCheck, fail, ok
from .text import TextAnalysis

WORDS_PER_URL = 500
MIN_ZLIB_RATIO = 0.20
MIN_UNIQUE_RATIO = 0.05
# Unique-word ratio falls as books get longer (Heaps' law), so measure it on a
# fixed-size sample; otherwise long real books would look repetitive.
UNIQUE_SAMPLE_WORDS = 5000
MIN_WORDS_TO_JUDGE = 200
MAX_KEYWORD_HITS = 2
URL_RE = re.compile(r"(?:https?://|www\.)\S+")
BLOCKLIST_PATH = Path(__file__).resolve().parents[1] / "blocklist.txt"


def spam_urls(analysis: TextAnalysis) -> ScanCheck:
    urls = len(URL_RE.findall(analysis.text))
    if urls * WORDS_PER_URL < max(analysis.word_count, 1) or urls == 0:
        return ok("spam.urls", "review", f"{urls} URLs in {analysis.word_count} words")
    return fail("spam.urls", "review", f"{urls} URLs in {analysis.word_count} words; limit is 1 per {WORDS_PER_URL}")


def spam_repeat(analysis: TextAnalysis) -> ScanCheck:
    if analysis.word_count < MIN_WORDS_TO_JUDGE:
        return ok("spam.repeat", "review", "too little text to judge")
    raw = analysis.text[:200_000].encode("utf-8")
    zlib_ratio = len(zlib.compress(raw, 9)) / len(raw)
    sample = analysis.words[:UNIQUE_SAMPLE_WORDS]
    unique_ratio = len(set(sample)) / len(sample)
    detail = f"zlib ratio {zlib_ratio:.2f}, unique-word ratio {unique_ratio:.3f} (first {len(sample)} words)"
    if zlib_ratio >= MIN_ZLIB_RATIO and unique_ratio >= MIN_UNIQUE_RATIO:
        return ok("spam.repeat", "review", detail)
    return fail("spam.repeat", "review", detail + "; text looks repetitive")


@lru_cache(maxsize=1)
def _blocklist() -> list[re.Pattern[str]]:
    phrases = []
    for line in BLOCKLIST_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip().lower()
        if line and not line.startswith("#"):
            phrases.append(re.compile(r"\b" + re.escape(line) + r"\b"))
    return phrases


def spam_keywords(analysis: TextAnalysis) -> ScanCheck:
    hits = {p.pattern: len(p.findall(analysis.text)) for p in _blocklist()}
    total = sum(hits.values())
    if total <= MAX_KEYWORD_HITS:
        return ok("spam.keywords", "review", f"{total} blocklist hits")
    top = ", ".join(f"{p[2:-2].replace(chr(92), '')} x{n}" for p, n in sorted(hits.items(), key=lambda kv: -kv[1]) if n)[:200]
    return fail("spam.keywords", "review", f"{total} blocklist hits: {top}")
