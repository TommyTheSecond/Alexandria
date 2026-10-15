"""In-memory upload limits: 5 per hour per client, 200 per day in total (README section 6).

Clients are keyed by sha256(daily salt + IP); the raw IP is never stored, and the
salt (and every key) is thrown away at 00:00 UTC. Tor users all arrive from the
local onion proxy, so they have no client key and only the daily total applies.
"""

from __future__ import annotations

import hashlib
import math
import secrets
import time
from collections import deque
from typing import Callable, Optional

HOUR = 3600
DAY = 86_400


class RateLimiter:
    def __init__(self, per_client_hour: int = 5, global_day: int = 200,
                 clock: Callable[[], float] = time.time) -> None:
        self.per_client_hour = per_client_hour
        self.global_day = global_day
        self._clock = clock
        self._day = -1
        self._salt = b""
        self._today = 0
        self._hits: dict[str, deque] = {}

    def _rotate(self, now: float) -> None:
        day = int(now // DAY)
        if day != self._day:
            self._day, self._salt, self._today, self._hits = day, secrets.token_bytes(16), 0, {}

    def client_key(self, client: Optional[str]) -> Optional[str]:
        if not client:
            return None
        self._rotate(self._clock())
        return hashlib.sha256(self._salt + client.encode("utf-8")).hexdigest()

    def check(self, client: Optional[str]) -> Optional[int]:
        """Record one attempt. Return None if allowed, else seconds until the client may retry."""
        now = self._clock()
        self._rotate(now)
        if self._today >= self.global_day:
            return max(1, math.ceil((self._day + 1) * DAY - now))
        key = self.client_key(client)
        if key is not None:
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - HOUR:
                hits.popleft()
            if len(hits) >= self.per_client_hour:
                return max(1, math.ceil(hits[0] + HOUR - now))
            hits.append(now)
        self._today += 1
        return None
