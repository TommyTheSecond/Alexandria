"""meta.schema and ban.source."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

from .base import ScanCheck, fail, ok

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas" / "book.schema.json"
# Fields the scanner fills in; an uploader's BookMetaInput must not send them.
FILLED_BY_SCANNER = ("schemaVersion", "pdf", "submittedVia", "scanReportCid")


@lru_cache(maxsize=1)
def input_validator() -> Draft202012Validator:
    """book.schema.json (I2) minus the scanner-filled fields: the BookMetaInput schema."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    for key in FILLED_BY_SCANNER:
        schema["properties"].pop(key, None)
    schema["required"] = [key for key in schema["required"] if key not in FILLED_BY_SCANNER]
    return Draft202012Validator(schema)


def meta_schema(meta: object) -> ScanCheck:
    errors = sorted(input_validator().iter_errors(meta), key=lambda e: [str(p) for p in e.path])
    if not errors:
        return ok("meta.schema", "reject")
    detail = "; ".join(f"{'/'.join(str(p) for p in e.path) or '(root)'}: {e.message}" for e in errors[:3])
    return fail("meta.schema", "reject", detail)


def ban_source(meta: dict) -> ScanCheck:
    bans = meta.get("bans") if isinstance(meta.get("bans"), list) else []
    if any(isinstance(b, dict) and str(b.get("sourceUrl", "")).startswith("https://") for b in bans):
        return ok("ban.source", "reject")
    return fail("ban.source", "reject", "needs at least 1 ban record with an https:// source URL")
