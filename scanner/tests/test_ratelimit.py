"""Upload rate limits: 5 per hour per client, 200 per day in total (README section 6)."""

from scanner.ratelimit import RateLimiter


class Clock:
    def __init__(self, t=1_792_040_400.0):
        self.t = t

    def __call__(self):
        return self.t


def test_allows_five_per_hour_then_limits():
    clock = Clock()
    limiter = RateLimiter(clock=clock)
    assert [limiter.check("203.0.113.9") for _ in range(5)] == [None] * 5
    retry = limiter.check("203.0.113.9")
    assert retry is not None and 1 <= retry <= 3600


def test_window_slides_after_an_hour():
    clock = Clock()
    limiter = RateLimiter(clock=clock)
    for _ in range(5):
        limiter.check("203.0.113.9")
    clock.t += 3601
    assert limiter.check("203.0.113.9") is None


def test_clients_are_counted_separately():
    limiter = RateLimiter(clock=Clock())
    for _ in range(5):
        limiter.check("203.0.113.9")
    assert limiter.check("198.51.100.4") is None


def test_global_daily_cap():
    limiter = RateLimiter(global_day=3, clock=Clock())
    assert [limiter.check(f"203.0.113.{i}") for i in range(3)] == [None] * 3
    assert limiter.check("203.0.113.99") is not None


def test_anonymous_clients_only_count_toward_global():
    limiter = RateLimiter(clock=Clock())
    assert all(limiter.check(None) is None for _ in range(10))


def test_raw_ip_never_stored():
    limiter = RateLimiter(clock=Clock())
    limiter.check("203.0.113.9")
    assert "203.0.113.9" not in repr(vars(limiter))


def test_salt_rotates_daily():
    clock = Clock()
    limiter = RateLimiter(clock=clock)
    today = limiter.client_key("203.0.113.9")
    clock.t += 86_400
    assert limiter.client_key("203.0.113.9") != today
