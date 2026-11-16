"""Load the golden set from data/golden/*.jsonl (read fresh on each call)."""

from __future__ import annotations

import json
import logging

from pydantic import ValidationError

from app import config
from app.schemas import REGULATOR_SOURCES, GoldenCase

log = logging.getLogger(__name__)


def _resolve_required(case: GoldenCase) -> GoldenCase:
    regulator = case.source_type in REGULATOR_SOURCES
    for f in case.expected_findings:
        if f.required is None:
            f.required = regulator or f.severity == "high"
    return case


def load_cases() -> list[GoldenCase]:
    cases: list[GoldenCase] = []
    seen: set[str] = set()
    for path in sorted(config.GOLDEN_DIR.glob("*.jsonl")):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as e:
            log.warning("cannot read %s: %s", path.name, e)
            continue
        for n, line in enumerate(lines, 1):
            if not line.strip():
                continue
            try:
                case = GoldenCase.model_validate(json.loads(line))
            except (json.JSONDecodeError, ValidationError) as e:
                log.warning("skipping %s:%d: %s", path.name, n, str(e).splitlines()[0])
                continue
            if case.id in seen:
                log.warning("skipping %s:%d: duplicate case id %s", path.name, n, case.id)
                continue
            seen.add(case.id)
            cases.append(_resolve_required(case))
    return cases


def get_case(case_id: str) -> GoldenCase | None:
    return next((c for c in load_cases() if c.id == case_id), None)
