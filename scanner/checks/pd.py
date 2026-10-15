"""pd.rule and pd.source (README section 10, public-domain rule for 2026)."""

from __future__ import annotations

from urllib.parse import urlparse

from .base import ScanCheck, fail, ok

MAX_FIRST_PUBLISHED = 1930  # US: 95-year term
MAX_DEATH_YEAR = 1955       # EU: life + 70
SOURCE_ALLOWLIST = ("gutenberg.org", "archive.org", "wikisource.org", "hathitrust.org")


def _people(meta: dict) -> list[tuple[str, dict]]:
    people = []
    for role, key in (("author", "authors"), ("translator", "translators")):
        for person in meta.get(key) or []:
            if isinstance(person, dict):
                people.append((role, person))
    return people


def pd_rule(meta: dict) -> ScanCheck:
    year = meta.get("firstPublishedYear")
    if not isinstance(year, int):
        return fail("pd.rule", "review", "first publication year is missing")
    if year > MAX_FIRST_PUBLISHED:
        return fail("pd.rule", "reject", f"first published {year}, after {MAX_FIRST_PUBLISHED}")
    people = _people(meta)
    late = [(r, p) for r, p in people if isinstance(p.get("deathYear"), int) and p["deathYear"] > MAX_DEATH_YEAR]
    if late:
        role, person = late[0]
        return fail("pd.rule", "reject",
                    f"{role} {person.get('name', '?')} died {person['deathYear']}, after {MAX_DEATH_YEAR}")
    unknown = [p.get("name", "?") for _, p in people if not isinstance(p.get("deathYear"), int)]
    if unknown:
        return fail("pd.rule", "review", "unknown death year: " + ", ".join(unknown))
    if not any(role == "author" for role, _ in people):
        return fail("pd.rule", "review", "no authors listed")
    return ok("pd.rule", "reject", f"published {year}; all authors and translators died by {MAX_DEATH_YEAR}")


def pd_source(meta: dict) -> ScanCheck:
    source = meta.get("publicDomain") if isinstance(meta.get("publicDomain"), dict) else {}
    url = urlparse(str(source.get("sourceUrl", "")))
    host = (url.hostname or "").lower()
    if url.scheme == "https" and any(host == d or host.endswith("." + d) for d in SOURCE_ALLOWLIST):
        return ok("pd.source", "review", host)
    return fail("pd.source", "review", f"public-domain source host {host or '(none)'} is not on the allowlist")
