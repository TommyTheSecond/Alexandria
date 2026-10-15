"""dup.sha256 (on-chain registry) and dup.text (MinHash near-duplicates)."""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import Callable, Optional

from datasketch import MinHash, MinHashLSH

from .base import ScanCheck, fail, ok

NEAR_DUP_JACCARD = 0.9
NUM_PERM = 128
SHINGLE_WORDS = 5

LookupId = Optional[Callable[[str], int]]


def dup_sha256(sha256: str, lookup_id: LookupId) -> ScanCheck:
    if lookup_id is None:
        return ok("dup.sha256", "reject", "registry not configured; skipped")
    try:
        existing = int(lookup_id(sha256))
    except Exception as exc:  # RPC outage: let a curator decide instead of rejecting
        return fail("dup.sha256", "review", f"registry lookup failed: {type(exc).__name__}")
    if existing:
        return fail("dup.sha256", "reject", f"already registered as book {existing}")
    return ok("dup.sha256", "reject", "not registered yet")


class NearDupIndex:
    """MinHash LSH over 5-word shingles of approved books."""

    def __init__(self, threshold: float = NEAR_DUP_JACCARD, num_perm: int = NUM_PERM) -> None:
        self.num_perm = num_perm
        self._lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)
        self._hashes: dict[str, MinHash] = {}

    def __len__(self) -> int:
        return len(self._hashes)

    def minhash(self, words: list[str]) -> MinHash:
        m = MinHash(num_perm=self.num_perm)
        for i in range(max(len(words) - SHINGLE_WORDS + 1, 1)):
            m.update(" ".join(words[i:i + SHINGLE_WORDS]).encode("utf-8"))
        return m

    def add(self, key: str, words: list[str]) -> None:
        if key in self._hashes:
            return
        m = self.minhash(words)
        self._lsh.insert(key, m)
        self._hashes[key] = m

    def query(self, words: list[str]) -> list[tuple[str, float]]:
        m = self.minhash(words)
        return sorted(((k, m.jaccard(self._hashes[k])) for k in self._lsh.query(m)), key=lambda kv: -kv[1])

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(pickle.dumps(self))

    @staticmethod
    def load(path: Path) -> "NearDupIndex":
        # Only ever loads the scanner's own file in scanner/data/ (never user input).
        return pickle.loads(path.read_bytes()) if path.exists() else NearDupIndex()


def dup_text(words: list[str], index: NearDupIndex | None) -> ScanCheck:
    if index is None or len(index) == 0:
        return ok("dup.text", "review", "no approved books indexed yet")
    matches = [(k, j) for k, j in index.query(words) if j >= NEAR_DUP_JACCARD]
    if matches:
        key, jaccard = matches[0]
        return fail("dup.text", "review", f"near duplicate of {key} (Jaccard similarity {jaccard:.2f})")
    return ok("dup.text", "review", "no near duplicate")
