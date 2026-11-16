"""Review pipeline: AdInput -> Report.

video: probe -> mono 16 kHz mp3 -> whisper-1 (+ scene cuts in parallel) -> frame picker
       (+ deterministic safety net) -> frame grabs -> extractor -> reviewer -> fixer
image: image -> extractor -> reviewer -> fixer
text:  copy  -> extractor -> reviewer -> fixer

CLI: uv run python -m app.pipeline <case_id>
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from collections.abc import Callable

from . import agents, config, llm, media
from .schemas import AdInput, Finding, Frame, GoldenCase, Report, Stage, TranscriptSegment

log = logging.getLogger(__name__)

MIN_FRAME_GAP = 0.7  # s; picks closer than this are merged
LONG_GAP = 6.0  # s; add a safety frame in any gap longer than this


def _safety_net(duration: float, picked: list[float]) -> list[tuple[float, str]]:
    """First frame, end card (last ~3 s), and one frame per long gap."""
    out: list[tuple[float, str]] = [(min(0.5, duration / 2), "safety net: opening frame")]
    if duration > 3:
        out.append((max(0.0, duration - 2.5), "safety net: end card (last 3 s)"))
    out.append((max(0.0, duration - 0.4), "safety net: final frame / end card fine print"))
    times = sorted({*picked, *(t for t, _ in out)})
    bounds = [0.0, *times, duration]
    for a, b in zip(bounds, bounds[1:]):
        if b - a > LONG_GAP:
            out.append((round((a + b) / 2, 2), f"safety net: gap {a:.1f}-{b:.1f}s had no frame"))
    return out


def _merge_moments(moments: list[tuple[float, str]]) -> list[tuple[float, str]]:
    merged: list[tuple[float, str]] = []
    for t, reason in sorted(moments, key=lambda m: m[0]):
        t = round(t, 2)
        if merged and t - merged[-1][0] < MIN_FRAME_GAP:
            continue  # keep the earlier (agent picks sort before safety-net duplicates only by time)
        merged.append((t, reason))
    return merged


def _nearest_frame(frames: list[Frame], t: float | None) -> str | None:
    if not frames:
        return None
    if t is None:
        return None
    return min(frames, key=lambda f: abs(f.t - t)).path


def _dedupe_citation(rule: str) -> str:
    seen: list[str] = []
    for part in (p.strip() for p in rule.split(";")):
        if part and part not in seen:
            seen.append(part)
    return "; ".join(seen)


def _write_report(report: Report) -> None:
    out = config.RUNS_DIR / "reports" / f"{report.ad_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report.model_dump_json(indent=2))


async def review(
    ad: AdInput, on_stage: Callable[[Stage], None] | None = None, *, fix: bool = True
) -> Report:
    """fix=False skips the fixer (the eval harness doesn't score fixes)."""
    t0 = time.monotonic()
    usage: dict[str, int] = {"input_tokens": 0, "output_tokens": 0}

    def stage(s: Stage) -> None:
        log.info("[%s] %s", ad.ad_id, s)
        if on_stage:
            on_stage(s)

    try:
        transcript: list[TranscriptSegment] = []
        frames: list[Frame] = []
        duration: float | None = None
        image_path: str | None = None

        if ad.modality in ("video", "image") and not ad.asset_path:
            raise ValueError(f"{ad.modality} ad {ad.ad_id} has no asset_path")
        if ad.modality == "text" and not (ad.text or "").strip():
            raise ValueError(f"text ad {ad.ad_id} has no text")

        if ad.modality == "video":
            stage("extracting_media")
            video = media.abs_path(ad.asset_path)
            duration, has_audio = await media.probe(video)
            cuts_task = asyncio.create_task(media.scene_cuts(video))
            audio = None
            if has_audio:
                audio = await media.extract_audio(video, config.RUNS_DIR / "audio" / f"{ad.ad_id}.mp3")

            stage("transcribing")
            transcript = await media.transcribe(audio, usage=usage)
            cuts = await cuts_task

            stage("picking_frames")
            try:
                picks = await agents.pick_frames(transcript, cuts, duration, usage)
                moments = [(m.t, m.reason) for m in picks]
            except Exception as e:  # the safety net still gives us frames
                log.warning("frame picker failed, using cuts only: %s", e)
                moments = [(min(c + 0.4, duration), "scene cut") for c in cuts[: config.MAX_FRAMES]]
            moments = _merge_moments(moments + _safety_net(duration, [t for t, _ in moments]))
            grabbed = await media.grab_frames(video, [t for t, _ in moments], ad.ad_id, duration)
            frames = [Frame(t=t, path=grabbed[t], reason=r) for t, r in moments if t in grabbed]
        elif ad.modality == "image":
            image_path = ad.asset_path
            if not media.abs_path(image_path).exists():
                raise FileNotFoundError(image_path)

        frame_pairs = [(f.t, f.path) for f in frames]

        try:
            stage("extracting_claims")
            extraction = await agents.extract_claims(
                ad.modality, ad.text, transcript, duration, frame_pairs, image_path, usage
            )

            stage("reviewing")
            rev = await agents.review(
                ad.modality, ad.text, transcript, duration, frame_pairs, image_path, extraction, usage
            )
        except llm.ContentFiltered as e:
            # Fail safe: a blocked review is routed to a human, never reported as compliant.
            log.warning("[%s] %s", ad.ad_id, e)
            report = Report(
                ad_id=ad.ad_id, modality=ad.modality, verdict="needs_review",
                summary=f"Automated review blocked by the model provider's content filter ({e}). "
                "Route this ad to a human reviewer.",
                transcript=transcript, frames=frames, model=config.MODEL,
                latency_s=round(time.monotonic() - t0, 2), usage=usage,
            )
            _write_report(report)
            stage("done")
            return report

        fixes: dict[int, str] = {}
        if fix and rev.findings:
            stage("fixing")
            try:
                fixes = await agents.suggest_fixes(extraction.product, rev.findings, usage)
            except Exception as e:  # fixer is optional
                log.warning("fixer failed: %s", e)

        frame_paths = {f.path for f in frames}
        findings: list[Finding] = []
        for i, f in enumerate(rev.findings):
            ts = None
            fp = None
            if ad.modality == "video":
                start = f.start_s if f.start_s is not None else 0.0
                end = f.end_s if f.end_s is not None else (duration or start)
                start, end = sorted((max(0.0, start), min(duration or end, end)))
                ts = (round(start, 2), round(end, 2))
                fp = f.frame_path if f.frame_path in frame_paths else _nearest_frame(frames, start)
            elif ad.modality == "image":
                fp = image_path
            findings.append(
                Finding(
                    category=f.category, claim=f.claim, rule=_dedupe_citation(f.rule), severity=f.severity,
                    rationale=f.rationale, evidence_channel=f.evidence_channel,
                    timestamp_s=ts, frame_path=fp, suggested_fix=fixes.get(i),
                )
            )

        report = Report(
            ad_id=ad.ad_id, modality=ad.modality, verdict=rev.verdict, summary=rev.summary,
            findings=findings, transcript=transcript, frames=frames, model=config.MODEL,
            latency_s=round(time.monotonic() - t0, 2), usage=usage,
        )
        _write_report(report)
        stage("done")
        return report
    except Exception:
        stage("error")
        raise


# ----------------------------------------------------------------- golden helpers + CLI


def review_case(case: GoldenCase) -> AdInput:
    """AdInput for a golden case. Media cases get only the asset: the golden ad_content is the
    label-side transcript and must not leak into the review."""
    if case.modality == "text":
        return AdInput(ad_id=case.id, modality="text", text=case.ad_content)
    return AdInput(ad_id=case.id, modality=case.modality, asset_path=case.asset_path)


def load_case(case_id: str) -> GoldenCase:
    for path in sorted(config.GOLDEN_DIR.glob("*.jsonl")):
        for line in path.read_text().splitlines():
            if line.strip():
                d = json.loads(line)
                if d.get("id") == case_id:
                    return GoldenCase.model_validate(d)
    raise KeyError(f"case {case_id!r} not found in {config.GOLDEN_DIR}")


def _summarise(report: Report, case: GoldenCase | None) -> str:
    lines = [
        f"{report.ad_id} [{report.modality}] verdict={report.verdict}"
        + (f" (expected {case.expected_verdict})" if case else ""),
        f"latency={report.latency_s}s usage={report.usage} frames={len(report.frames)} "
        f"transcript_segments={len(report.transcript)}",
        f"summary: {report.summary}",
    ]
    for f in report.findings:
        ts = f" @{f.timestamp_s[0]:.1f}-{f.timestamp_s[1]:.1f}s" if f.timestamp_s else ""
        lines.append(f"- [{f.severity}] {f.category} ({f.evidence_channel}{ts}) {f.claim[:110]!r}")
        lines.append(f"    rule: {f.rule[:120]}" + (f" | frame: {f.frame_path}" if f.frame_path else ""))
    if case:
        lines.append("expected: " + ", ".join(sorted({g.category for g in case.expected_findings})))
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if not argv:
        print("usage: python -m app.pipeline <case_id> [<case_id> ...]")
        return 2
    for case_id in argv:
        case = load_case(case_id)
        report = asyncio.run(review(review_case(case)))
        print(_summarise(report, case), flush=True)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
