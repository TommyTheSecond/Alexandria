"""Read-only registry lookup: idBySha256(bytes32) over JSON-RPC (no wallet, no web3 dependency)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional

import httpx
from Crypto.Hash import keccak

TIMEOUT_S = 15


def selector(signature: str) -> str:
    """First 4 bytes of keccak256(signature), as 8 hex digits."""
    return keccak.new(digest_bits=256, data=signature.encode("ascii")).hexdigest()[:8]


ID_BY_SHA256 = selector("idBySha256(bytes32)")


def make_lookup_id(rpc_url: str, contract: str, client: Optional[httpx.Client] = None) -> Callable[[str], int]:
    http = client or httpx.Client(timeout=TIMEOUT_S)

    def lookup(sha256: str) -> int:
        call = {"to": contract, "data": "0x" + ID_BY_SHA256 + sha256[2:]}
        body = {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [call, "latest"]}
        reply = http.post(rpc_url, json=body).json()
        if "error" in reply or "result" not in reply:
            raise RuntimeError(f"eth_call failed: {reply.get('error', {}).get('message', 'no result')}")
        return int(reply["result"], 16)

    return lookup


def load_deployment(path: Path) -> Optional[dict]:
    """I7 deployment record, or None until A1 has deployed."""
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
