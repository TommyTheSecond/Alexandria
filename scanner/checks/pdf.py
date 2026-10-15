"""pdf.magic, pdf.size, pdf.parse, pdf.active. Parsing runs inside the sandbox child."""

from __future__ import annotations

import io

import pikepdf

from .base import ScanCheck, fail, ok

MAX_PDF_BYTES = 31_457_280
MIN_PAGES = 10

REJECT_KEYS = frozenset({
    "/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/EmbeddedFiles", "/RichMedia", "/XFA", "/AA",
})
REJECT_ACTIONS = frozenset({"/JavaScript", "/Launch", "/ImportData", "/RichMediaExecute", "/Rendition"})
MAX_DEPTH = 64


def pdf_magic(data: bytes) -> ScanCheck:
    if data[:5] == b"%PDF-":
        return ok("pdf.magic", "reject")
    return fail("pdf.magic", "reject", "file does not start with %PDF-")


def pdf_size(size: int) -> ScanCheck:
    if size <= MAX_PDF_BYTES:
        return ok("pdf.size", "reject", f"{size} bytes")
    return fail("pdf.size", "reject", f"{size} bytes; limit is {MAX_PDF_BYTES}")


def pdf_parse(data: bytes) -> ScanCheck:
    try:
        with pikepdf.open(io.BytesIO(data)) as pdf:
            if pdf.is_encrypted:
                return fail("pdf.parse", "reject", "encrypted PDF")
            pages = len(pdf.pages)
    except pikepdf.PasswordError:
        return fail("pdf.parse", "reject", "encrypted PDF (password required)")
    except Exception as exc:  # any parser failure means we cannot trust the file
        return fail("pdf.parse", "reject", f"cannot parse PDF: {type(exc).__name__}")
    if pages < MIN_PAGES:
        return fail("pdf.parse", "reject", f"{pages} pages; at least {MIN_PAGES} required")
    return ok("pdf.parse", "reject", f"{pages} pages")


def page_count(data: bytes) -> int:
    with pikepdf.open(io.BytesIO(data)) as pdf:
        return len(pdf.pages)


def _find_active(obj: pikepdf.Object, depth: int = 0) -> str | None:
    """Search one object and its direct (non-indirect) children for active content."""
    if depth > MAX_DEPTH:
        return None
    if isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream)):
        keys = set(obj.keys())
        bad = keys & REJECT_KEYS
        if bad:
            return f"active content: {sorted(bad)[0]}"
        action = obj.get("/S")
        if isinstance(action, pikepdf.Name) and str(action) in REJECT_ACTIONS:
            return f"active content: action {action}"
        open_action = obj.get("/OpenAction")
        if isinstance(open_action, pikepdf.Dictionary) and "/S" in open_action:
            return "active content: /OpenAction runs an action"
        children = [obj.get(key) for key in keys]
    elif isinstance(obj, pikepdf.Array):
        children = list(obj)
    else:
        return None
    for child in children:
        if isinstance(child, (pikepdf.Dictionary, pikepdf.Array, pikepdf.Stream)) and not child.is_indirect:
            hit = _find_active(child, depth + 1)
            if hit:
                return hit
    return None


def pdf_active(data: bytes) -> ScanCheck:
    """Walk every object, including ones from object streams and incremental updates."""
    try:
        with pikepdf.open(io.BytesIO(data)) as pdf:
            for obj in [pdf.trailer, *pdf.objects]:
                hit = _find_active(obj)
                if hit:
                    return fail("pdf.active", "reject", hit)
    except Exception as exc:
        return fail("pdf.active", "reject", f"cannot inspect PDF objects: {type(exc).__name__}")
    return ok("pdf.active", "reject", "no active content")
