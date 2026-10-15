from __future__ import annotations

from dataclasses import asdict, dataclass

DETAIL_MAX = 500  # scan-report.schema.json limit


@dataclass(frozen=True)
class ScanCheck:
    id: str
    passed: bool
    severity: str  # "reject" or "review": what a failure of this check means
    detail: str

    def to_dict(self) -> dict:
        return asdict(self)


def ok(check_id: str, severity: str, detail: str = "ok") -> ScanCheck:
    return ScanCheck(check_id, True, severity, detail[:DETAIL_MAX])


def fail(check_id: str, severity: str, detail: str) -> ScanCheck:
    return ScanCheck(check_id, False, severity, detail[:DETAIL_MAX])
