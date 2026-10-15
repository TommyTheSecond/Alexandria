"""Client for the relayer (I6, 127.0.0.1:8787), which submits books on-chain for wallet-free uploaders."""

from __future__ import annotations

from typing import Optional

import httpx

# The relayer waits for 1 confirmation and queues requests, so allow time.
TIMEOUT_S = 120


class RelayError(RuntimeError):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


class DuplicateBook(RelayError):
    def __init__(self, existing_id: int) -> None:
        super().__init__("DUPLICATE", f"already registered as book {existing_id}")
        self.existing_id = existing_id


class RelayClient:
    def __init__(self, url: str, secret: str, client: Optional[httpx.Client] = None) -> None:
        self.url = url.rstrip("/")
        self.secret = secret
        self.client = client or httpx.Client(timeout=TIMEOUT_S)

    def relay(self, pdf_cid: str, meta_cid: str, pdf_sha256: str) -> tuple[int, str]:
        try:
            response = self.client.post(f"{self.url}/relay", headers={"X-Relay-Secret": self.secret},
                                        json={"pdfCid": pdf_cid, "metaCid": meta_cid, "pdfSha256": pdf_sha256})
        except httpx.HTTPError as exc:
            raise RelayError("UNREACHABLE", type(exc).__name__) from None
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code == 200:
            return int(body["bookId"]), str(body["txHash"])
        if response.status_code == 409 and "existingId" in body:
            raise DuplicateBook(int(body["existingId"]))
        raise RelayError(str(body.get("code") or f"HTTP_{response.status_code}"), str(body.get("detail", ""))[:200])
