"""Kubo / Filebase pinning, relayer client and registry lookup, against mock transports."""

import json

import httpx
import pytest

from scanner.chain import load_deployment, make_lookup_id, selector
from scanner.pinning import FilebasePinner, KuboPinner, Pinner, PinError
from scanner.relay import DuplicateBook, RelayClient, RelayError
from scanner.settings import load_env_file

CID = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"
SHA = "0x" + "c" * 64
TX = "0x" + "ab" * 32


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


# --- Kubo ---------------------------------------------------------------------

def test_kubo_add_posts_file_and_returns_cid():
    seen = {}

    def handler(request):
        seen["path"], seen["query"] = request.url.path, dict(request.url.params)
        seen["body"] = request.read()
        return httpx.Response(200, json={"Name": "book.pdf", "Hash": CID, "Size": "9"})

    cid = KuboPinner("http://127.0.0.1:5001", client=_client(handler)).add(b"%PDF-data", "book.pdf")
    assert cid == CID
    assert seen["path"] == "/api/v0/add"
    assert seen["query"]["cid-version"] == "1" and seen["query"]["pin"] == "true"
    assert b"%PDF-data" in seen["body"]


def test_kubo_error_raises_pin_error():
    kubo = KuboPinner("http://127.0.0.1:5001", client=_client(lambda r: httpx.Response(500, text="boom")))
    with pytest.raises(PinError):
        kubo.add(b"x", "x")


def test_kubo_unreachable_raises_pin_error():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(PinError):
        KuboPinner("http://127.0.0.1:5001", client=_client(handler)).add(b"x", "x")


def test_kubo_export_car():
    def handler(request):
        assert request.url.path == "/api/v0/dag/export" and request.url.params["arg"] == CID
        return httpx.Response(200, content=b"CARBYTES")

    assert KuboPinner("http://127.0.0.1:5001", client=_client(handler)).export_car(CID) == b"CARBYTES"


# --- Filebase -----------------------------------------------------------------

class FakeS3:
    def __init__(self, error=None, returned_cid=CID):
        self.calls, self.error, self.returned_cid = [], error, returned_cid

    def put_object(self, **kwargs):
        if self.error:
            raise self.error
        self.calls.append(kwargs)
        return {"ResponseMetadata": {"HTTPHeaders": {"x-amz-meta-cid": self.returned_cid}}}


class FakeKubo:
    def add(self, data, filename):
        return CID

    def export_car(self, cid):
        return b"CAR:" + cid.encode()


def test_pinner_uploads_car_to_filebase():
    s3 = FakeS3()
    cid = Pinner(FakeKubo(), FilebasePinner("alexandria", s3)).pin(b"data", "book.pdf")
    assert cid == CID
    assert s3.calls == [{"Bucket": "alexandria", "Key": f"{CID}.car", "Body": b"CAR:" + CID.encode(),
                         "Metadata": {"import": "car"}}]


def test_filebase_failure_does_not_fail_pin():
    assert Pinner(FakeKubo(), FilebasePinner("alexandria", FakeS3(error=RuntimeError("403")))).pin(b"d", "x") == CID


def test_filebase_cid_mismatch_is_logged(caplog):
    other = "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    with caplog.at_level("WARNING", logger="alexandria.scanner"):
        cid = Pinner(FakeKubo(), FilebasePinner("alexandria", FakeS3(returned_cid=other))).pin(b"d", "x")
    assert cid == CID
    assert "CID mismatch" in caplog.text


def test_pinner_without_filebase_uses_kubo_only():
    assert Pinner(FakeKubo(), None).pin(b"d", "x") == CID


# --- relayer (I6) -------------------------------------------------------------

def test_relay_sends_secret_and_fields():
    seen = {}

    def handler(request):
        seen["secret"] = request.headers.get("x-relay-secret")
        seen["path"] = request.url.path
        seen["json"] = json.loads(request.read())
        return httpx.Response(200, json={"bookId": 5, "txHash": TX})

    relay = RelayClient("http://127.0.0.1:8787", "s3cret", client=_client(handler))
    assert relay.relay(CID, CID, SHA) == (5, TX)
    assert seen == {"secret": "s3cret", "path": "/relay", "json": {"pdfCid": CID, "metaCid": CID, "pdfSha256": SHA}}


def test_relay_409_raises_duplicate_with_existing_id():
    relay = RelayClient("http://x", "s", client=_client(
        lambda r: httpx.Response(409, json={"code": "DUPLICATE", "existingId": 3})))
    with pytest.raises(DuplicateBook) as err:
        relay.relay(CID, CID, SHA)
    assert err.value.existing_id == 3


@pytest.mark.parametrize("status,code", [(429, "DAILY_CAP"), (502, "CHAIN_ERROR"), (401, "UNAUTHORIZED")])
def test_relay_errors_carry_relayer_code(status, code):
    relay = RelayClient("http://x", "s", client=_client(lambda r: httpx.Response(status, json={"code": code})))
    with pytest.raises(RelayError) as err:
        relay.relay(CID, CID, SHA)
    assert err.value.code == code


def test_relay_unreachable():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(RelayError) as err:
        RelayClient("http://x", "s", client=_client(handler)).relay(CID, CID, SHA)
    assert err.value.code == "UNREACHABLE"


# --- registry lookup ----------------------------------------------------------

def test_selector_matches_known_erc20_transfer():
    assert selector("transfer(address,uint256)") == "a9059cbb"


def test_lookup_builds_eth_call_and_parses_result():
    contract = "0x" + "12" * 20

    def handler(request):
        body = json.loads(request.read())
        assert body["method"] == "eth_call"
        call = body["params"][0]
        assert call["to"] == contract
        assert call["data"] == "0x" + selector("idBySha256(bytes32)") + SHA[2:]
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": "0x" + "0" * 63 + "7"})

    assert make_lookup_id("http://rpc", contract, client=_client(handler))(SHA) == 7


def test_lookup_rpc_error_raises():
    lookup = make_lookup_id("http://rpc", "0x" + "12" * 20, client=_client(
        lambda r: httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "x"}})))
    with pytest.raises(RuntimeError):
        lookup(SHA)


def test_load_deployment_missing_returns_none(tmp_path):
    assert load_deployment(tmp_path / "fuji.json") is None


def test_load_deployment_reads_address(tmp_path):
    path = tmp_path / "fuji.json"
    path.write_text(json.dumps({"chainId": 43113, "address": "0x" + "12" * 20}), encoding="utf-8")
    assert load_deployment(path)["address"] == "0x" + "12" * 20


# --- .env loader --------------------------------------------------------------

def test_env_file_sets_missing_values_only(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("# comment\nA3_TEST_ONE=1\nA3_TEST_TWO = two words\n\nA3_TEST_SET=from-file\n", encoding="utf-8")
    monkeypatch.delenv("A3_TEST_ONE", raising=False)
    monkeypatch.delenv("A3_TEST_TWO", raising=False)
    monkeypatch.setenv("A3_TEST_SET", "from-env")
    load_env_file(env)
    import os
    assert os.environ["A3_TEST_ONE"] == "1"
    assert os.environ["A3_TEST_TWO"] == "two words"
    assert os.environ["A3_TEST_SET"] == "from-env"
