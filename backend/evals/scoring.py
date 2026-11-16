"""Pure scoring functions for the eval harness. No I/O.

Matching rule (see the design doc, "Scoring"):
- a predicted finding matches a golden finding when the categories are equal and,
  if both carry a timestamp window, the windows overlap within +/- TOLERANCE_S;
- each golden finding is matched at most once: greedy, required findings first,
  then best overlap;
- a prediction that is compatible with no golden finding (required or optional)
  is a false flag. A surplus prediction that re-flags an already-matched golden
  finding is a duplicate, not a false flag.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from app.schemas import (
    REGULATOR_SOURCES,
    CaseScore,
    EvalRun,
    Finding,
    GoldenCase,
    GoldenFinding,
    Report,
    Verdict,
)

OMISSION_CATEGORIES = {"missing_risk_information", "inadequate_disclosure_prominence"}
TOLERANCE_S = 2.0
RECALL_DROP = 0.05
VERDICT_DROP = 0.05


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Signed overlap of two windows in seconds (negative = gap between them)."""
    return min(a[1], b[1]) - max(a[0], b[0])


def _compatible(g: GoldenFinding, p: Finding) -> tuple[bool, float]:
    if g.category != p.category:
        return False, 0.0
    if g.timestamp_s is not None and p.timestamp_s is not None:
        ov = _overlap(g.timestamp_s, p.timestamp_s)
        return ov >= -TOLERANCE_S, ov
    return True, 0.0


def verdict_ok(expected: Verdict, predicted: Verdict | None) -> bool:
    if predicted is None:
        return False
    if expected == "needs_review":
        return predicted in ("needs_review", "non_compliant")
    return predicted == expected


def _label(category: str, claim: str) -> str:
    return f"{category}: {claim}"


def match(golden: Sequence[GoldenFinding], preds: Sequence[Finding]) -> tuple[dict[int, int], set[int]]:
    """Returns ({golden_idx: pred_idx} one-to-one matches, {pred_idx compatible with any golden})."""
    pairs = []
    compatible_preds: set[int] = set()
    for gi, g in enumerate(golden):
        for pi, p in enumerate(preds):
            ok, ov = _compatible(g, p)
            if ok:
                compatible_preds.add(pi)
                pairs.append((0 if g.required is not False else 1, -ov, gi, pi))
    pairs.sort()
    matches: dict[int, int] = {}
    used_preds: set[int] = set()
    for _, _, gi, pi in pairs:
        if gi in matches or pi in used_preds:
            continue
        matches[gi] = pi
        used_preds.add(pi)
    return matches, compatible_preds


def _neutral(case: GoldenCase, pred: Finding) -> bool:
    """Omission findings on regulator excerpts can't be judged either way.

    Text cases from FDA/FTC/NAD sources are the lines the regulator quoted, not the
    whole ad, so "no risk information" / "risk info not prominent" may be an artifact
    of the excerpt. Such predictions are neither false flags nor counted in precision.
    """
    return (
        case.modality == "text"
        and case.source_type in REGULATOR_SOURCES
        and pred.category in OMISSION_CATEGORIES
    )


def score_case(case: GoldenCase, report: Report | None, error: str | None) -> CaseScore:
    golden = case.expected_findings
    required = [i for i, g in enumerate(golden) if g.required is not False]
    if report is None:
        return CaseScore(
            case_id=case.id,
            modality=case.modality,
            expected_verdict=case.expected_verdict,
            predicted_verdict=None,
            verdict_ok=False,
            must_catch_total=len(required),
            must_catch_hit=0,
            missed=[_label(golden[i].category, golden[i].claim) for i in required],
            error=error or "no report",
        )

    preds = report.findings
    matches, compatible = match(golden, preds)
    missed = [_label(golden[i].category, golden[i].claim) for i in required if i not in matches]
    false_flags = [
        _label(p.category, p.claim)
        for pi, p in enumerate(preds)
        if pi not in compatible and not _neutral(case, p)
    ]

    ts_total = ts_hits = 0
    if case.modality == "video":
        for gi, pi in matches.items():
            g_ts, p_ts = golden[gi].timestamp_s, preds[pi].timestamp_s
            if g_ts is None:
                continue
            ts_total += 1
            if p_ts is not None and _overlap(g_ts, p_ts) >= -TOLERANCE_S:
                ts_hits += 1

    return CaseScore(
        case_id=case.id,
        modality=case.modality,
        expected_verdict=case.expected_verdict,
        predicted_verdict=report.verdict,
        verdict_ok=verdict_ok(case.expected_verdict, report.verdict),
        must_catch_total=len(required),
        must_catch_hit=len(required) - len(missed),
        missed=missed,
        false_flags=false_flags,
        timestamp_total=ts_total,
        timestamp_hits=ts_hits,
        latency_s=report.latency_s,
        error=error,
    )


def _ratio(num: float, den: float, empty: float = 1.0) -> float:
    return num / den if den else empty


def headline(scores: Sequence[CaseScore]) -> dict[str, float | None]:
    """Metrics that can be recomputed from CaseScores alone (used for baseline diffs)."""
    ts_total = sum(s.timestamp_total for s in scores)
    return {
        "verdict_accuracy": _ratio(sum(s.verdict_ok for s in scores), len(scores), 0.0),
        "must_catch_recall": _ratio(sum(s.must_catch_hit for s in scores), sum(s.must_catch_total for s in scores)),
        "false_flags_on_compliant": sum(len(s.false_flags) for s in scores if s.expected_verdict == "compliant"),
        "timestamp_hit_rate": _ratio(sum(s.timestamp_hits for s in scores), ts_total) if ts_total else None,
    }


def compare(current: EvalRun, baseline: EvalRun) -> tuple[dict[str, float], list[str]]:
    """Deltas (current - baseline) and regression messages.

    If both runs carry per-case scores over different case sets (e.g. the golden
    set grew), compare on the common cases so new cases don't read as regressions.
    """
    cur_ids = {s.case_id for s in current.cases}
    base_ids = {s.case_id for s in baseline.cases}
    common = cur_ids & base_ids
    note = ""
    if baseline.cases and common and cur_ids != base_ids:
        cur = headline([s for s in current.cases if s.case_id in common])
        base = headline([s for s in baseline.cases if s.case_id in common])
        note = f" (on {len(common)} common cases)"
    else:
        cur = {k: getattr(current, k) for k in ("verdict_accuracy", "must_catch_recall", "false_flags_on_compliant", "timestamp_hit_rate")}
        base = {k: getattr(baseline, k) for k in cur}
        cur["precision"], base["precision"] = current.precision, baseline.precision

    deltas = {k: round(cur[k] - base[k], 4) for k in cur if cur[k] is not None and base.get(k) is not None}

    regressions = []
    for key, limit, label in (
        ("must_catch_recall", RECALL_DROP, "Must-catch recall"),
        ("verdict_accuracy", VERDICT_DROP, "Verdict accuracy"),
    ):
        if base[key] - cur[key] > limit:
            regressions.append(f"{label} dropped {base[key]:.2f} -> {cur[key]:.2f}{note}")
    if cur["false_flags_on_compliant"] > base["false_flags_on_compliant"]:
        regressions.append(
            f"False flags on compliant controls rose {base['false_flags_on_compliant']} -> {cur['false_flags_on_compliant']}{note}"
        )
    return deltas, regressions


def aggregate(
    scores: Sequence[CaseScore],
    cases: Sequence[GoldenCase],
    reports: Sequence[Report | None],
    model: str,
    baseline: EvalRun | None,
    run_id: str | None = None,
) -> EvalRun:
    now = datetime.now(timezone.utc)
    by_id = {c.id: c for c in cases}
    reports_by_id = {r.ad_id: r for r in reports if r is not None}

    n_preds = n_matched = 0
    per_cat: dict[str, list[int]] = {}
    for s in scores:
        case = by_id.get(s.case_id)
        report = reports_by_id.get(s.case_id)
        if case is None:
            continue
        matches: dict[int, int] = {}
        if report is not None:
            matches, compatible = match(case.expected_findings, report.findings)
            judged = [
                pi for pi, p in enumerate(report.findings)
                if pi in compatible or not _neutral(case, p)
            ]
            n_preds += len(judged)
            n_matched += len(judged) - len(s.false_flags)
        for gi, g in enumerate(case.expected_findings):
            if g.required is False:
                continue
            hit_total = per_cat.setdefault(g.category, [0, 0])
            hit_total[1] += 1
            hit_total[0] += gi in matches

    h = headline(scores)
    usage: dict[str, int] = {}
    for r in reports:
        for k, v in (r.usage if r else {}).items():
            usage[k] = usage.get(k, 0) + int(v)

    run = EvalRun(
        run_id=run_id or now.strftime("%Y%m%dT%H%M%SZ"),
        created_at=now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        model=model,
        n_cases=len(scores),
        verdict_accuracy=round(h["verdict_accuracy"], 4),
        must_catch_recall=round(h["must_catch_recall"], 4),
        precision=round(_ratio(n_matched, n_preds), 4),
        false_flags_on_compliant=int(h["false_flags_on_compliant"]),
        timestamp_hit_rate=None if h["timestamp_hit_rate"] is None else round(h["timestamp_hit_rate"], 4),
        per_category={c: {"recall": round(hit / tot, 4), "support": tot} for c, (hit, tot) in sorted(per_cat.items())},
        cases=list(scores),
        total_latency_s=round(sum(s.latency_s for s in scores), 2),
        usage=usage,
    )
    if baseline is not None:
        run.baseline_run_id = baseline.run_id
        run.deltas, run.regressions = compare(run, baseline)
    return run
