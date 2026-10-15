"""CLI entrypoint for scanner.nodecheck."""

import argparse
from pathlib import Path
import sys

from scanner.nodecheck.probe import run_probe
from scanner.nodecheck.report import run_report


def main() -> int:
    parser = argparse.ArgumentParser(description="Alexandria node gateway checker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # probe command
    probe_parser = subparsers.add_parser("probe", help="Probe registered node gateways")
    probe_parser.add_argument("--targets", required=True, type=Path, help="Path to targets.json")
    probe_parser.add_argument("--state", required=True, type=Path, help="State directory")

    # report command
    report_parser = subparsers.add_parser("report", help="Generate epoch report")
    report_parser.add_argument("--state", required=True, type=Path, help="State directory")
    report_parser.add_argument("--epoch", required=True, type=int, help="Epoch number")
    report_parser.add_argument("--out", required=True, type=Path, help="Output report.json path")

    args = parser.parse_args()

    if args.command == "probe":
        results = run_probe(args.targets, args.state)
        print(f"probe: executed {len(results)} check(s)")
        return 0
    elif args.command == "report":
        report_data = run_report(args.state, args.epoch, args.out)
        active_count = len(report_data.get("active", []))
        print(f"report: epoch {args.epoch} generated with {active_count} active operator(s)")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
