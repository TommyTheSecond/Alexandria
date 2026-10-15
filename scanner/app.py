"""Scanner HTTP API (I5). Run: python -m uvicorn scanner.app:app --host 127.0.0.1 --port 8000 --no-access-log"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from . import __version__
from .checks import MAX_PDF_BYTES
from .checks.dup import LookupId
from .pipeline import scan

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"
SHA_RE = re.compile(r"^0x[0-9a-f]{64}$")
CHUNK = 1 << 20


def _error(status: int, code: str, detail: str = "") -> JSONResponse:
    return JSONResponse({"code": code, "detail": detail}, status_code=status)


async def _read_limited(upload: UploadFile) -> tuple[bytes, str, int]:
    """Hash the whole upload but keep only the first MAX_PDF_BYTES + 1 bytes."""
    digest, kept, total = hashlib.sha256(), bytearray(), 0
    while chunk := await upload.read(CHUNK):
        digest.update(chunk)
        total += len(chunk)
        if len(kept) <= MAX_PDF_BYTES:
            kept += chunk[: MAX_PDF_BYTES + 1 - len(kept)]
    return bytes(kept), "0x" + digest.hexdigest(), total


async def _parse_upload(request: Request) -> tuple[Optional[JSONResponse], Optional[tuple]]:
    form = await request.form(max_files=1, max_fields=4)
    pdf, meta_raw = form.get("pdf"), form.get("meta")
    if not isinstance(pdf, UploadFile):
        return _error(400, "INVALID_INPUT", "multipart field 'pdf' (file) is required"), None
    if not isinstance(meta_raw, str):
        return _error(400, "INVALID_INPUT", "multipart field 'meta' (JSON string) is required"), None
    try:
        meta = json.loads(meta_raw)
    except ValueError:
        return _error(400, "INVALID_INPUT", "'meta' is not valid JSON"), None
    data, sha, total = await _read_limited(pdf)
    return None, (data, meta, sha, total)


def create_app(data_dir: Optional[Path] = None, *, lookup_id: LookupId = None) -> FastAPI:
    data_dir = Path(data_dir or os.environ.get("ALEXANDRIA_DATA_DIR") or DEFAULT_DATA_DIR)
    app = FastAPI(title="Alexandria scanner", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                       allow_methods=["GET", "POST"], allow_headers=["*"])

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "scannerVersion": __version__}

    @app.post("/api/scan")
    async def scan_only(request: Request):
        error, parsed = await _parse_upload(request)
        if error:
            return error
        data, meta, sha, total = parsed
        return await run_in_threadpool(scan, data, meta, lookup_id=lookup_id, sha256=sha, total_size=total)

    @app.get("/api/report/{sha256}")
    def report(sha256: str):
        if not SHA_RE.match(sha256):
            return _error(400, "INVALID_INPUT", "expected 0x + 64 lowercase hex digits")
        path = data_dir / "reports" / f"{sha256}.json"
        if not path.is_file():
            return _error(404, "NOT_FOUND")
        return JSONResponse(json.loads(path.read_text(encoding="utf-8")))

    return app


app = create_app()
