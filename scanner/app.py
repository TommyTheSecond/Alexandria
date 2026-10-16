"""Scanner HTTP API (I5). Run: python -m uvicorn scanner.app:app --host 127.0.0.1 --port 8000 --no-access-log"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import logging
import re
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from . import __version__, settings
from .checks import MAX_PDF_BYTES, NearDupIndex
from .checks.bounty import bounty_check_from_env
from .checks.dup import LookupId
from .pipeline import scan
from .ratelimit import RateLimiter
from .submit import SubmitService

log = logging.getLogger("alexandria.scanner")
DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"
SHA_RE = re.compile(r"^0x[0-9a-f]{64}$")
CHUNK = 1 << 20
_UNSET = object()


def _error(status: int, code: str, detail: str = "", **extra) -> JSONResponse:
    return JSONResponse({"code": code, "detail": detail, **extra}, status_code=status)


def _is_loopback(host: Optional[str]) -> bool:
    try:
        return host is not None and ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def client_ip(request: Request) -> Optional[str]:
    """The uploader's IP, or None when unknown (Tor users all arrive via the local onion proxy).
    X-Forwarded-For is trusted only from a loopback proxy (Caddy, cloudflared)."""
    host = request.client.host if request.client else None
    if not _is_loopback(host):
        return host
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return None if not forwarded or _is_loopback(forwarded) else forwarded


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
    form = await request.form(max_files=1, max_fields=5)
    pdf, meta_raw, via = form.get("pdf"), form.get("meta"), form.get("via") or "web"
    if not isinstance(pdf, UploadFile):
        return _error(400, "INVALID_INPUT", "multipart field 'pdf' (file) is required"), None
    if not isinstance(meta_raw, str):
        return _error(400, "INVALID_INPUT", "multipart field 'meta' (JSON string) is required"), None
    try:
        meta = json.loads(meta_raw)
    except ValueError:
        return _error(400, "INVALID_INPUT", "'meta' is not valid JSON"), None
    data, sha, total = await _read_limited(pdf)
    return None, (data, meta, sha, total, str(via))


def service_from_env(data_dir: Path) -> tuple[Optional[SubmitService], LookupId]:
    """Build the submit pipeline from scanner/.env + environment. Without RELAY_SECRET, /api/submit is off."""
    from .chain import load_deployment, make_lookup_id
    from .pinning import FilebasePinner, KuboPinner, Pinner
    from .relay import RelayClient

    settings.load_env_file()
    deployment = load_deployment(Path(settings.get("DEPLOYMENT", str(settings.REPO_ROOT / "deployments" / "fuji.json"))))
    lookup = None
    if deployment and deployment.get("address"):
        lookup = make_lookup_id(settings.get("RPC_URL", "https://api.avax-test.network/ext/bc/C/rpc"),
                                deployment["address"])
    secret = settings.get("RELAY_SECRET")
    if not secret:
        log.warning("RELAY_SECRET not set: /api/submit answers 503")
        return None, lookup
    filebase = None
    if settings.get("FILEBASE_BUCKET") and settings.get("FILEBASE_ACCESS_KEY_ID") and settings.get("FILEBASE_SECRET_ACCESS_KEY"):
        filebase = FilebasePinner.from_keys(settings.get("FILEBASE_BUCKET"), settings.get("FILEBASE_ACCESS_KEY_ID"),
                                            settings.get("FILEBASE_SECRET_ACCESS_KEY"))
    pinner = Pinner(KuboPinner(settings.get("KUBO_API_URL", "http://127.0.0.1:5001")), filebase)
    relay = RelayClient(settings.get("RELAYER_URL", "http://127.0.0.1:8787"), secret)
    from .submit import ALLOW_REUPLOADS_DEFAULT
    raw_reupload = settings.get("ALLOW_REUPLOADS")
    allow_reuploads = ALLOW_REUPLOADS_DEFAULT if raw_reupload is None else raw_reupload.strip().lower() not in ("0", "false", "no")
    service = SubmitService(pinner=pinner, relay=relay, data_dir=data_dir, lookup_id=lookup,
                            near_dup=NearDupIndex.load(data_dir / "minhash.pkl"),
                            bounty_check=bounty_check_from_env(settings.get, settings.REPO_ROOT),
                            allow_reuploads=allow_reuploads)
    return service, lookup


def create_app(data_dir: Optional[Path] = None, *, lookup_id: LookupId = None, submit_service=_UNSET,
               limiter: Optional[RateLimiter] = None, bounty_check=_UNSET) -> FastAPI:
    data_dir = Path(data_dir or settings.get("ALEXANDRIA_DATA_DIR") or DEFAULT_DATA_DIR)
    if submit_service is _UNSET:
        submit_service, env_lookup = service_from_env(data_dir)
        lookup_id = lookup_id or env_lookup
    limiter = limiter or RateLimiter(per_client_hour=int(settings.get("UPLOADS_PER_HOUR", "5")),
                                     global_day=int(settings.get("UPLOADS_PER_DAY", "200")))
    if bounty_check is _UNSET:  # None unless deployments/fuji-bounties.json exists (I9)
        bounty_check = bounty_check_from_env(settings.get, settings.REPO_ROOT)
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
        data, meta, sha, total, _ = parsed
        return await run_in_threadpool(scan, data, meta, lookup_id=lookup_id, sha256=sha, total_size=total,
                                       bounty_check=bounty_check)

    @app.post("/api/submit")
    async def submit(request: Request):
        if submit_service is None:
            return _error(503, "NOT_CONFIGURED", "uploads are not enabled on this server yet")
        client = client_ip(request)
        retry = limiter.check(client)
        if retry is not None:
            return _error(429, "RATE_LIMIT", "too many uploads; try later", retryAfterSec=retry)
        error, parsed = await _parse_upload(request)
        if error:
            limiter.refund(client)
            return error
        data, meta, sha, total, via = parsed
        result = await run_in_threadpool(submit_service.submit, data, meta, via=via, sha256=sha, total_size=total)
        if 400 <= result.status < 500:  # bad input, duplicate, too large or rejected scan: the slot goes back
            limiter.refund(client)
        return JSONResponse(result.body, status_code=result.status)

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
