"""Verdict and score (README section 6)."""

from __future__ import annotations

from typing import Iterable

from .checks import ScanCheck

REVIEW_PENALTY = 15


def verdict_and_score(results: Iterable[ScanCheck]) -> tuple[str, int]:
    results = list(results)
    rejected = any(not r.passed and r.severity == "reject" for r in results)
    reviews = sum(1 for r in results if not r.passed and r.severity == "review")
    score = max(0, 100 - REVIEW_PENALTY * reviews)
    return ("reject" if rejected else "review" if reviews else "pass"), score
