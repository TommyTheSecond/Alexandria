"""Pin to our own Kubo node (canonical CIDs) and mirror to Filebase as a CAR, so both hold the same CID."""

from __future__ import annotations

import logging
from typing import Optional

import httpx

log = logging.getLogger("alexandria.scanner")
TIMEOUT_S = 120


class PinError(RuntimeError):
    pass


class KuboPinner:
    def __init__(self, api_url: str = "http://127.0.0.1:5001", client: Optional[httpx.Client] = None) -> None:
        self.api_url = api_url.rstrip("/")
        self.client = client or httpx.Client(timeout=TIMEOUT_S)

    def _post(self, path: str, **kwargs) -> httpx.Response:
        try:
            response = self.client.post(f"{self.api_url}{path}", **kwargs)
        except httpx.HTTPError as exc:
            raise PinError(f"Kubo unreachable: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise PinError(f"Kubo {path} returned HTTP {response.status_code}")
        return response

    def add(self, data: bytes, filename: str) -> str:
        response = self._post("/api/v0/add", params={"cid-version": "1", "pin": "true"},
                              files={"file": (filename, data, "application/octet-stream")})
        try:
            return response.json()["Hash"]
        except (ValueError, KeyError):
            raise PinError("Kubo add returned no Hash") from None

    def export_car(self, cid: str) -> bytes:
        return self._post("/api/v0/dag/export", params={"arg": cid}).content


class FilebasePinner:
    """Filebase S3 bucket; a CAR upload with metadata import=car keeps the CID Kubo computed."""

    def __init__(self, bucket: str, s3_client) -> None:
        self.bucket = bucket
        self.s3 = s3_client

    def pin_car(self, cid: str, car: bytes) -> Optional[str]:
        """Upload the CAR; return the root CID Filebase reports (x-amz-meta-cid), if any."""
        response = self.s3.put_object(Bucket=self.bucket, Key=f"{cid}.car", Body=car, Metadata={"import": "car"})
        headers = (response or {}).get("ResponseMetadata", {}).get("HTTPHeaders", {})
        return headers.get("x-amz-meta-cid")

    @staticmethod
    def from_keys(bucket: str, access_key: str, secret_key: str) -> "FilebasePinner":
        import boto3  # only needed when Filebase is configured

        s3 = boto3.client("s3", endpoint_url="https://s3.filebase.com", region_name="us-east-1",
                          aws_access_key_id=access_key, aws_secret_access_key=secret_key)
        return FilebasePinner(bucket, s3)


class Pinner:
    """Kubo is required and decides the CID. Filebase is a best-effort second copy:
    a Filebase failure is logged (without secrets) and A6's pin-sync can retry it."""

    def __init__(self, kubo: KuboPinner, filebase: Optional[FilebasePinner] = None) -> None:
        self.kubo = kubo
        self.filebase = filebase

    def pin(self, data: bytes, filename: str) -> str:
        cid = self.kubo.add(data, filename)
        if self.filebase is not None:
            try:
                stored = self.filebase.pin_car(cid, self.kubo.export_car(cid))
            except Exception as exc:  # second copy only; never block the upload
                log.warning("Filebase copy failed for %s: %s", cid, type(exc).__name__)
            else:
                if stored and stored != cid:
                    log.warning("Filebase CID mismatch: Kubo %s, Filebase %s", cid, stored)
        return cid
