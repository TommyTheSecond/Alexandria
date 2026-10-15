"""Build the Alexandria test fixtures (A3 task T0).

Offline, deterministic, and free of copyrighted text: book bodies are seeded
random words from WORDS below.

Committed outputs (rebuild with `python fixtures/make_fixtures.py`):
  fixtures/pdfs/good.pdf, good-2.pdf, good-3.pdf   three distinct 12-page PDFs
  fixtures/meta/good*.json                         BookMetaInput (what an uploader sends)
  fixtures/meta/full/good*.json                    full BookMeta (I2), the bytes behind each metaCid
  fixtures/catalog.json                            Catalog (I4) with the 3 books
  fixtures/ipfs-index.json                         CID -> file path, for mock gateways

Generated at test time into fixtures/out/ (gitignored): the reject and review
sets, so antivirus never quarantines committed files.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pikepdf
import pymupdf

ROOT = Path(__file__).resolve().parent
MAX_PDF_BYTES = 31_457_280
# Kubo's default chunk size. A file this size or smaller is one raw block, so its
# CIDv1 is computable offline; bigger files become multi-block DAGs.
MAX_SINGLE_BLOCK = 262_144

FIXED_TIME = datetime(2026, 10, 15, 4, 30, tzinfo=timezone.utc)
PDF_DATE = "D:20261015043000Z"

WORDS = tuple(
    """
    able about above across act add afraid after again against age ago agree air all almost alone along
    already also always among amount and anger animal another answer any apple area arm army around arrive
    art ask attack aunt autumn away baby back bad bag ball bank base basket bath bear beat beautiful bed
    bee before begin behind bell belt bench berry best better between bird birth bit bite black blade
    blood blow blue board boat body bone book border bottle bottom box boy brain branch brass bread break
    breath brick bridge bright bring brother brown brush bucket build burn bus busy butter button cake
    call calm camera camp candle cap card care carry cart case castle cat cause chain chair chalk chance
    change cheap cheese chest chief child chin church circle city class clean clear clock close cloth
    cloud coal coast coat cold collar colour comb come common copper cord corn corner cotton cough country
    cover cow crack crime cross crowd crown cry cup current curtain curve cushion cut damage danger dark
    daughter day dead dear death debt decide deep degree delay desert desire detail dinner direction dirty
    distance doctor dog door double down drain drawer dream dress drink drive drop dry dust duty early
    earth east edge egg engine enough equal error even evening event every example exchange expert eye
    face fact fall false family far farm fast father fear feather feeling fence fever field fight finger
    fire first fish flag flame flat floor flower fly fold food foot force fork form forward frame friend
    front fruit garden gate general gift girl glass glove goat gold good grain grass great green grey
    grip group growth guide gun hair hall hammer hand happy harbour hard harvest hat head health hearing
    heart heat heavy help high hill history hole hollow hook hope horn horse hospital hour house humour
    ice idea ink inside iron island jelly jewel journey judge juice jump kettle key kind king kiss knee
    knife knot knowledge lace lady lamp land language late laugh lead leaf learning leather left letter
    level library light limit line linen lip liquid list little lock long loose loss loud love low
    machine man map mark market mass meal measure meat memory metal middle milk mind mine minute mist
    money monkey month moon morning mother mountain mouth move music nail name narrow nation near neck
    needle nerve net news night noise north nose note number nut oak ocean office oil old open orange
    order oven owner page pain paint paper parcel part paste path peace pen pencil person picture pig pin
    pipe place plane plant plate play pleasure plough pocket point poison polish porter pot powder power
    present price print prison private process prose public pump punishment purpose quiet rail rain range
    rat ray reading reason receipt record red regret relation religion request rest reward rhythm rice
    right ring river road rod roll roof room root rope rough round rule run sail salt sand scale school
    science scissors screw sea seat second secret seed self sense servant shade shake shame sheep shelf
    ship shirt shock shoe short side sign silk silver sister size skin skirt sky sleep slope small smell
    smile smoke snake snow soap society sock soft soldier song sort sound soup south space spade spoon
    spring square stage stamp star start station steam steel stem step stick still stitch stomach stone
    store story street strong summer sun support surprise sweet swim table tail talk taste tax teaching
    test theory thick thin thing thought thread throat thumb thunder ticket time tin tired toe tongue
    tooth top touch town trade train tray tree trick trouble true turn twist umbrella uncle under unit
    valley value verse vessel view violin voice walk wall war wash waste watch water wave wax way weather
    week weight west wheel whip whistle white wide wind window wine wing winter wire wise woman wood wool
    word work worm wound writer year yellow young
    """.split()
)


# --- hashes and CIDs ---------------------------------------------------------

def sha256_hex(data: bytes) -> str:
    """Lowercase hex with 0x prefix, the project-wide hash format."""
    return "0x" + hashlib.sha256(data).hexdigest()


def cid_v1_raw(data: bytes) -> str:
    """CIDv1, raw codec, sha2-256, base32: what `ipfs add --cid-version=1` returns for one block."""
    if len(data) > MAX_SINGLE_BLOCK:
        raise ValueError(f"{len(data)} bytes is more than one block; use Kubo to get the CID")
    multihash = bytes([0x12, 0x20]) + hashlib.sha256(data).digest()
    cid = bytes([0x01, 0x55]) + multihash
    return "b" + base64.b32encode(cid).decode("ascii").lower().rstrip("=")


# --- PDF builders ------------------------------------------------------------

def random_words(seed: int, count: int) -> list[str]:
    rng = random.Random(seed)
    return [rng.choice(WORDS) for _ in range(count)]


def _save(doc: pymupdf.Document, path: Path, title: str, author: str) -> None:
    doc.set_metadata({
        "title": title,
        "author": author,
        "creator": "alexandria fixtures",
        "producer": "alexandria fixtures",
        "creationDate": PDF_DATE,
        "modDate": PDF_DATE,
    })
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(doc.tobytes(garbage=4, deflate=True, no_new_id=True))
    doc.close()


def build_text_pdf(path: Path, *, title: str, author: str, pages: int, words: int = 0,
                   seed: int = 0, body: list[str] | None = None) -> Path:
    """A5 PDF; page 1 starts with the title and author, then the body words spread over the pages."""
    body = body if body is not None else random_words(seed, words)
    per_page = math.ceil(len(body) / pages) if body else 0
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=420, height=595)
        text = " ".join(body[i * per_page:(i + 1) * per_page])
        if i == 0:
            text = f"{title}\n{author}\n\n{text}"
        if page.insert_textbox(pymupdf.Rect(36, 36, 384, 559), text, fontsize=9, fontname="helv") < 0:
            raise ValueError(f"text does not fit on page {i + 1} of {path.name}")
    _save(doc, path, title, author)
    return path


def build_image_only_pdf(path: Path, pages: int = 12) -> Path:
    """Pages with drawings and no text layer, like a scan without OCR."""
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=420, height=595)
        page.draw_rect(pymupdf.Rect(60, 60 + i * 10, 360, 300 + i * 10), color=(0, 0, 0), fill=(0.8, 0.8, 0.8))
    _save(doc, path, "", "")
    return path


# --- the three committed fixture books ---------------------------------------

def _ban(country: str, authority: str, year: int, scope: str, n: int, historical: str | None = None) -> dict:
    ban: dict = {"country": country}
    if historical:
        ban["historicalAuthority"] = historical
    ban.update(authority=authority, year=year, scope=scope,
               sourceUrl=f"https://example.org/alexandria-fixtures/ban-{n}")
    return ban


BOOKS = [
    {
        "file": "good", "seed": 1, "pdf_title": "Fixture Book", "pdf_author": "Ada Fixture",
        "status": "approved", "flags": 0, "confirmed": False,
        "input": {
            "title": "Fixture Book",
            "authors": [{"name": "Ada Fixture", "deathYear": 1920}],
            "translators": [],
            "firstPublishedYear": 1900,
            "language": "en",
            "description": "Generated test fixture. Random words, not a real book.",
            "publicDomain": {"sourceName": "Project Gutenberg", "sourceUrl": "https://www.gutenberg.org/ebooks/1"},
            "bans": [_ban("US", "Fixture County Library Board", 1925, "library", 1)],
        },
    },
    {
        "file": "good-2", "seed": 2, "pdf_title": "Fixture Book Two", "pdf_author": "Basil Fixture",
        "status": "flagged", "flags": 3, "confirmed": False,
        "input": {
            "title": "Fixture Book Two",
            "authors": [{"name": "Basil Fixture", "deathYear": 1910}],
            "translators": [{"name": "Clara Fixture", "deathYear": 1940}],
            "firstPublishedYear": 1895,
            "language": "en",
            "description": "Generated test fixture with a translator and a flagged status.",
            "publicDomain": {"sourceName": "Wikisource", "sourceUrl": "https://en.wikisource.org/wiki/Fixture"},
            "bans": [_ban("RU", "Fixture Censorship Committee", 1896, "national", 2, historical="Russian Empire")],
        },
    },
    {
        "file": "good-3", "seed": 3, "pdf_title": "Fixture Book Three", "pdf_author": "Lev Fixture",
        "status": "approved", "flags": 0, "confirmed": False,
        "input": {
            "title": "测试之书 (Fixture Book Three)",
            "authors": [{"name": "Лев Фикстуров", "deathYear": 1910}],
            "translators": [],
            "firstPublishedYear": 1880,
            "language": "zh",
            "description": "Generated test fixture with a Chinese title and a Cyrillic author name.",
            "publicDomain": {"sourceName": "Internet Archive", "sourceUrl": "https://archive.org/details/fixture"},
            "bans": [_ban("CN", "Fixture Provincial Office", 1890, "regional", 3, historical="Qing dynasty")],
        },
    },
]


def _json_bytes(obj: object) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def full_meta(meta_input: dict, *, pdf_bytes: bytes, pages: int, via: str = "web") -> dict:
    """BookMeta (I2) as the scanner fills it in for a pass/review upload."""
    return {
        "schemaVersion": "1.0.0",
        **meta_input,
        "pdf": {"cid": cid_v1_raw(pdf_bytes), "sha256": sha256_hex(pdf_bytes), "bytes": len(pdf_bytes), "pages": pages},
        "submittedVia": via,
        "scanReportCid": None,
    }


def build_committed(root: Path = ROOT) -> None:
    index: dict[str, str] = {}
    books = []
    for i, spec in enumerate(BOOKS, start=1):
        pdf_path = build_text_pdf(root / "pdfs" / f"{spec['file']}.pdf", title=spec["pdf_title"],
                                  author=spec["pdf_author"], pages=12, words=2520, seed=spec["seed"])
        pdf_bytes = pdf_path.read_bytes()
        (root / "meta").mkdir(parents=True, exist_ok=True)
        (root / "meta" / f"{spec['file']}.json").write_bytes(_json_bytes(spec["input"]))
        meta = full_meta(spec["input"], pdf_bytes=pdf_bytes, pages=12)
        meta_bytes = _json_bytes(meta)
        (root / "meta" / "full").mkdir(parents=True, exist_ok=True)
        (root / "meta" / "full" / f"{spec['file']}.json").write_bytes(meta_bytes)
        pdf_cid, meta_cid = meta["pdf"]["cid"], cid_v1_raw(meta_bytes)
        index[pdf_cid] = f"pdfs/{spec['file']}.pdf"
        index[meta_cid] = f"meta/full/{spec['file']}.json"
        books.append({
            "id": i,
            "status": spec["status"],
            "flags": spec["flags"],
            "confirmed": spec["confirmed"],
            "submitter": "0x" + "0" * 38 + f"{i:02x}",
            "submittedAt": int(FIXED_TIME.timestamp()) + i * 60,
            "pdfCid": pdf_cid,
            "metaCid": meta_cid,
            "pdfSha256": meta["pdf"]["sha256"],
            "meta": meta,
        })
    catalog = {
        "network": "fuji",
        "chainId": 43113,
        "contract": "0x" + "0" * 36 + "a1e0",
        "atBlock": 1,
        "generatedAt": FIXED_TIME.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "snapshot",
        "books": books,
    }
    (root / "catalog.json").write_bytes(_json_bytes(catalog))
    (root / "ipfs-index.json").write_bytes(_json_bytes(dict(sorted(index.items()))))


# --- reject and review sets (generated at test time) ------------------------

@dataclass(frozen=True)
class Case:
    pdf: Path
    meta: dict = field(hash=False)  # BookMetaInput sent with the PDF
    expect: str                     # "reject" or "review"
    check: str                      # the check id expected to fail (README section 6)


def _good_input() -> dict:
    return json.loads(json.dumps(BOOKS[0]["input"]))


def _eicar() -> bytes:
    # Built at runtime so this source file never holds the whole test signature.
    head = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$"
    tail = "EICAR-STANDARD-" + "ANTIVIRUS-TEST-FILE!$H+H*"
    return (head + tail).encode("ascii")


def _with_pikepdf(base: Path, out: Path, edit) -> Path:
    with pikepdf.open(base) as pdf:
        edit(pdf)
        pdf.save(out)
    return out


def build_reject_set(out: Path, include_eicar: bool = False) -> dict[str, Case]:
    out.mkdir(parents=True, exist_ok=True)
    base = build_text_pdf(out / "_base.pdf", title="Fixture Book", author="Ada Fixture", pages=12, words=2520, seed=1)
    good = _good_input()
    cases: dict[str, Case] = {}

    def add(name: str, pdf: Path, check: str, meta: dict | None = None) -> None:
        cases[name] = Case(pdf=pdf, meta=meta or good, expect="reject", check=check)

    notpdf = out / "notpdf.pdf"
    notpdf.write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(64))
    add("notpdf", notpdf, "pdf.magic")

    too_large = out / "too_large.pdf"
    data = base.read_bytes()
    too_large.write_bytes(data + b"\n%" + b"0" * (MAX_PDF_BYTES + 1 - len(data) - 2))
    add("too_large", too_large, "pdf.size")

    encrypted = out / "encrypted.pdf"
    with pikepdf.open(base) as pdf:
        pdf.save(encrypted, encryption=pikepdf.Encryption(owner="owner", user="user", R=6))
    add("encrypted", encrypted, "pdf.parse")

    add("five_pages", build_text_pdf(out / "five_pages.pdf", title="Fixture Book", author="Ada Fixture",
                                     pages=5, words=1200, seed=5), "pdf.parse")

    def js_open_action(pdf: pikepdf.Pdf) -> None:
        pdf.Root.OpenAction = pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert(1)"))
    add("js_openaction", _with_pikepdf(base, out / "js_openaction.pdf", js_open_action), "pdf.active")

    def launch(pdf: pikepdf.Pdf) -> None:
        pdf.Root.OpenAction = pikepdf.Dictionary(S=pikepdf.Name.Launch, F=pikepdf.String("calc.exe"))
    add("launch_action", _with_pikepdf(base, out / "launch_action.pdf", launch), "pdf.active")

    embedded = out / "embedded_file.pdf"
    doc = pymupdf.open(base)
    doc.embfile_add("note.txt", b"hello")
    embedded.write_bytes(doc.tobytes())
    doc.close()
    add("embedded_file", embedded, "pdf.active")

    incremental = out / "js_incremental_update.pdf"
    incremental.write_bytes(base.read_bytes())
    doc = pymupdf.open(incremental)
    doc.xref_set_key(doc.pdf_catalog(), "OpenAction", "<</S/JavaScript/JS(app.alert\\(1\\))>>")
    doc.saveIncr()
    doc.close()
    add("js_incremental_update", incremental, "pdf.active")

    objstm = out / "js_object_stream.pdf"
    with pikepdf.open(base) as pdf:
        action = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert(1)")))
        pdf.Root.Names = pikepdf.Dictionary(
            JavaScript=pikepdf.Dictionary(Names=pikepdf.Array([pikepdf.String("a"), action])))
        pdf.save(objstm, object_stream_mode=pikepdf.ObjectStreamMode.generate, compress_streams=True)
    add("js_object_stream", objstm, "pdf.active")

    published_1990 = _good_input()
    published_1990["firstPublishedYear"] = 1990
    add("meta_published_1990", base, "pd.rule", published_1990)

    died_1980 = _good_input()
    died_1980["authors"][0]["deathYear"] = 1980
    add("meta_author_died_1980", base, "pd.rule", died_1980)

    no_https_ban = _good_input()
    no_https_ban["bans"][0]["sourceUrl"] = "http://example.org/alexandria-fixtures/ban-1"
    add("meta_no_ban_source", base, "ban.source", no_https_ban)

    if include_eicar:
        eicar = out / "eicar.pdf"
        eicar.write_bytes(_eicar())
        add("eicar", eicar, "av.clamav")

    return cases


def build_review_set(out: Path) -> dict[str, Case]:
    out.mkdir(parents=True, exist_ok=True)
    good = _good_input()

    def text_case(name: str, body: list[str], check: str) -> Case:
        pdf = build_text_pdf(out / f"{name}.pdf", title="Fixture Book", author="Ada Fixture", pages=12, body=body)
        return Case(pdf=pdf, meta=good, expect="review", check=check)

    urls = random_words(11, 2520)
    for i in range(0, len(urls), 40):
        urls[i] = f"https://spam.example/p{i}"
    keywords = random_words(12, 2520)
    for i, phrase in zip(range(0, 2520, 500), ("casino", "airdrop", "click here", "casino", "airdrop")):
        keywords[i] = phrase
    repeat = ("the same line again and again".split()) * 420

    return {
        "spam_urls": text_case("spam_urls", urls, "spam.urls"),
        "spam_keywords": text_case("spam_keywords", keywords, "spam.keywords"),
        "spam_repeat": text_case("spam_repeat", repeat, "spam.repeat"),
        "no_text": Case(pdf=build_image_only_pdf(out / "no_text.pdf"), meta=good, expect="review", check="text.extract"),
    }


def main() -> None:
    build_committed(ROOT)
    rejects = build_reject_set(ROOT / "out" / "reject")
    reviews = build_review_set(ROOT / "out" / "review")
    print(f"committed fixtures rebuilt in {ROOT}")
    print(f"{len(rejects)} reject cases, {len(reviews)} review cases in {ROOT / 'out'}")


if __name__ == "__main__":
    main()
