"""Run the golden set through the pipeline, score it, diff against the previous run.

    uv run python -m evals.run_eval [--cases fda-001,vid-001] [--concurrency 4]

Exits 1 when the run regresses against the baseline.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import logging
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from app import cache, config
from app.golden import load_cases
from app.schemas import AdInput, CaseScore, EvalRun, GoldenCase, Report
from evals.scoring import aggregate, score_case

log = logging.getLogger(__name__)


def reports_dir() -> Path:
    return config.RUNS_DIR / "reports"


def evals_dir() -> Path:
    return config.RUNS_DIR / "evals"


def pipeline():
    """Imported lazily so the API and tests work before/without the real pipeline."""
    return importlib.import_module("app.pipeline")


def to_ad_input(case: GoldenCase) -> AdInput:
    p = pipeline()
    if hasattr(p, "review_case"):
        return p.review_case(case)
    # media cases get only the asset: ad_content is the label-side transcript
    text = case.ad_content if case.modality == "text" else None
    return AdInput(ad_id=case.id, modality=case.modality, text=text, asset_path=case.asset_path)


def save_report(report: Report) -> None:
    d = reports_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{report.ad_id}.json").write_text(report.model_dump_json(indent=2))


def new_run_id() -> str:
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    n = 1
    candidate = run_id
    while (evals_dir() / f"{candidate}.json").exists():
        n += 1
        candidate = f"{run_id}-{n}"
    return candidate


def list_runs() -> list[EvalRun]:
    """All saved runs, newest first. Unreadable files are skipped."""
    runs = []
    for path in evals_dir().glob("*.json") if evals_dir().exists() else []:
        try:
            runs.append(EvalRun.model_validate_json(path.read_text()))
        except Exception as e:  # noqa: BLE001 - a corrupt run file must not break the harness
            log.warning("skipping run file %s: %s", path.name, e)
    return sorted(runs, key=lambda r: (r.created_at, r.run_id), reverse=True)


def pick_baseline(case_ids: set[str], exclude: str | None = None) -> EvalRun | None:
    """Most recent previous run with the largest overlap of case ids."""
    best, best_overlap = None, 0
    for run in list_runs():  # newest first, so ties keep the most recent
        if run.run_id == exclude:
            continue
        overlap = len(case_ids & {c.case_id for c in run.cases})
        if overlap > best_overlap:
            best, best_overlap = run, overlap
    return best


# Smoke suite: 8 cases covering every violation category (must-catch), every modality,
# two compliant controls. For fast feedback while iterating; the full set is the gate.
SUITES: dict[str, list[str]] = {
    "smoke": ["div-006", "div-004", "div-002", "img-003", "vid-001", "vid-003", "fda-006", "vid-004"],
}


async def run_eval(
    case_ids: list[str] | None = None,
    concurrency: int = 4,
    on_progress: Callable[[int, int], None] | None = None,
    run_id: str | None = None,
    *,
    fix: bool = False,
    use_cache: bool = True,
) -> EvalRun:
    """fix=False: the fixer isn't scored, so evals skip it. use_cache: unchanged steps
    (same prompt + inputs + model) are read from runs/cache instead of re-billed."""
    cache.enabled.set(use_cache)  # inherited by the per-case tasks below
    cases = load_cases()
    if case_ids:
        wanted = set(case_ids)
        unknown = wanted - {c.id for c in cases}
        if unknown:
            raise ValueError(f"unknown case ids: {', '.join(sorted(unknown))}")
        cases = [c for c in cases if c.id in wanted]

    run_id = run_id or new_run_id()
    sem = asyncio.Semaphore(max(1, concurrency))
    done = 0
    total = len(cases)
    if on_progress:
        on_progress(0, total)

    async def one(case: GoldenCase) -> tuple[Report | None, str | None]:
        nonlocal done
        async with sem:
            report, error = None, None
            try:
                report = await pipeline().review(to_ad_input(case), fix=fix)
                save_report(report)
            except Exception as e:  # noqa: BLE001 - one bad case must not kill the run
                log.exception("case %s failed", case.id)
                error = f"{type(e).__name__}: {e}"
            done += 1
            if on_progress:
                on_progress(done, total)
            return report, error

    results = await asyncio.gather(*(one(c) for c in cases))
    reports = [r for r, _ in results]
    scores = [score_case(c, r, e) for c, (r, e) in zip(cases, results)]
    model = next((r.model for r in reports if r is not None), config.MODEL)
    baseline = pick_baseline({c.id for c in cases}, exclude=run_id)
    run = aggregate(scores, cases, reports, model, baseline, run_id=run_id)

    evals_dir().mkdir(parents=True, exist_ok=True)
    (evals_dir() / f"{run.run_id}.json").write_text(run.model_dump_json(indent=2))
    return run


# ---------------------------------------------------------------------- CLI

RED, GREEN, YELLOW, DIM, BOLD, RESET = "\033[31m", "\033[32m", "\033[33m", "\033[2m", "\033[1m", "\033[0m"


def _c(text: str, color: str) -> str:
    return f"{color}{text}{RESET}" if sys.stdout.isatty() else text


def _case_row(s: CaseScore) -> str:
    if s.error:
        status = _c(f"{'ERROR':<6}", RED)
    elif s.verdict_ok and not s.missed and not s.false_flags:
        status = _c(f"{'PASS':<6}", GREEN)
    else:
        status = _c(f"{'FAIL':<6}", RED if not s.verdict_ok or s.missed else YELLOW)
    pred = s.predicted_verdict or "-"
    return (
        f"  {s.case_id:<10} {s.modality:<6} {status}  {s.expected_verdict:<14} {pred:<14}"
        f" {s.must_catch_hit}/{s.must_catch_total:<5} {len(s.false_flags):<4} {s.latency_s:>6.1f}s"
    )


def print_report(run: EvalRun) -> None:
    print()
    print(_c(f"Eval run {run.run_id}  model={run.model}  cases={run.n_cases}", BOLD))
    print()
    head = f"  {'case':<10} {'mod':<6} {'status':<6}  {'expected':<14} {'predicted':<14} {'catch':<7} {'FF':<4} {'latency':>7}"
    print(_c(head, DIM))
    for s in run.cases:
        print(_case_row(s))
        for m in s.missed:
            print(_c(f"      missed: {m[:110]}", RED))
        for f in s.false_flags:
            print(_c(f"      false flag: {f[:106]}", YELLOW))
        if s.error:
            print(_c(f"      error: {s.error[:110]}", RED))

    if run.per_category:
        print()
        print(_c("  Per-category must-catch recall", BOLD))
        for cat, v in run.per_category.items():
            bar = "#" * round(v["recall"] * 20)
            print(f"    {cat:<36} {v['recall']:>5.0%}  {bar:<20} (n={int(v['support'])})")

    print()
    print(_c("  Headline", BOLD))
    ts = "n/a" if run.timestamp_hit_rate is None else f"{run.timestamp_hit_rate:.0%}"
    rows = [
        ("must_catch_recall", "Must-catch recall", f"{run.must_catch_recall:.0%}"),
        ("verdict_accuracy", "Verdict accuracy", f"{run.verdict_accuracy:.0%}"),
        ("precision", "Precision", f"{run.precision:.0%}"),
        ("false_flags_on_compliant", "False flags on compliant", str(run.false_flags_on_compliant)),
        ("timestamp_hit_rate", "Timestamp hit rate", ts),
    ]
    higher_is_better = {"false_flags_on_compliant": False}
    for key, label, value in rows:
        delta = ""
        if key in run.deltas:
            d = run.deltas[key]
            good = d >= 0 if higher_is_better.get(key, True) else d <= 0
            txt = f"{d:+.0f}" if key == "false_flags_on_compliant" else f"{d * 100:+.1f} pts"
            delta = _c(txt, GREEN if good else RED) if d else _c("±0", DIM)
        print(f"    {label:<28} {value:>6}   {delta}")
    tokens = ", ".join(f"{k}={v}" for k, v in run.usage.items()) or "n/a"
    print(f"    {'Total latency':<28} {run.total_latency_s:>5.1f}s   tokens: {tokens}")

    print()
    if run.baseline_run_id is None:
        print(_c("  No baseline run to compare against.", DIM))
    elif run.regressions:
        print(_c(f"  REGRESSIONS vs {run.baseline_run_id}:", RED + BOLD))
        for r in run.regressions:
            print(_c(f"    - {r}", RED))
    else:
        print(_c(f"  No regressions vs {run.baseline_run_id}.", GREEN))
    print(_c(f"  Saved {evals_dir() / (run.run_id + '.json')}", DIM))
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the compliance eval harness")
    parser.add_argument("--cases", help="comma-separated case ids (default: all)")
    parser.add_argument("--suite", choices=sorted(SUITES), help="named case set, e.g. smoke")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--no-cache", action="store_true", help="re-run every model call (measure variance)")
    parser.add_argument("--with-fixes", action="store_true", help="also run the (unscored) fixer")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    case_ids = [c.strip() for c in args.cases.split(",") if c.strip()] if args.cases else None
    if args.suite:
        case_ids = SUITES[args.suite]

    def progress(done: int, total: int) -> None:
        print(f"\r  reviewing... {done}/{total}", end="", file=sys.stderr, flush=True)

    try:
        run = asyncio.run(
            run_eval(case_ids, args.concurrency, progress, fix=args.with_fixes, use_cache=not args.no_cache)
        )
    except ValueError as e:
        print(f"\nerror: {e}", file=sys.stderr)
        return 2
    print(file=sys.stderr)
    print_report(run)
    return 1 if run.regressions else 0


if __name__ == "__main__":
    sys.exit(main())
