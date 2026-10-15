"""`python -m scanner scan` for curators (A3 task T1)."""

import json

from fixtures import make_fixtures as mf
from scanner.__main__ import main


def test_cli_scan_good_prints_report_and_exits_0(tmp_path, capsys):
    meta = tmp_path / "meta.json"
    meta.write_text(json.dumps(mf._good_input()), encoding="utf-8")
    code = main(["scan", str(mf.ROOT / "pdfs" / "good.pdf"), "--meta", str(meta)])
    assert code == 0
    assert json.loads(capsys.readouterr().out)["verdict"] == "pass"


def test_cli_scan_reject_exits_2(tmp_path, capsys):
    case = mf.build_reject_set(tmp_path)["js_openaction"]
    meta = tmp_path / "meta.json"
    meta.write_text(json.dumps(case.meta), encoding="utf-8")
    assert main(["scan", str(case.pdf), "--meta", str(meta)]) == 2
