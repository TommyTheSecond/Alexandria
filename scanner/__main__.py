"""Curator CLI: python -m scanner scan <pdf> --meta <json>. Exit code 0 pass, 1 review, 2 reject."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .pipeline import scan

EXIT_CODES = {"pass": 0, "review": 1, "reject": 2}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m scanner")
    sub = parser.add_subparsers(dest="command", required=True)
    scan_cmd = sub.add_parser("scan", help="scan one PDF with its BookMetaInput JSON and print the report")
    scan_cmd.add_argument("pdf", type=Path)
    scan_cmd.add_argument("--meta", type=Path, required=True)
    args = parser.parse_args(argv)
    report = scan(args.pdf.read_bytes(), json.loads(args.meta.read_text(encoding="utf-8")))
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return EXIT_CODES[report["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
