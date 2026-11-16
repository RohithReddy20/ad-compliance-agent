# Telehealth Ad Compliance Agent — Design

## Why
DirectMeds' FLUX platform has agents that write and review image and video ads. FDA has sent 100+ warning letters to telehealth firms over GLP-1 marketing since Sept 2025 (including one to DirectMeds). This agent reviews an ad (text, image or video) before it ships, flags claims that could break FDA/FTC rules with a rule citation and the exact moment in the video, and suggests safer wording. Findings are "flagged for human review", never legal conclusions.

## Goals / non-goals / anti-goals
- **Goals:** review text, image and video ads; for video, ground every finding in a timestamp and a frame; an eval harness over a real golden set that catches regressions; a React UI a reviewer would actually use.
- **Non-goals:** legal sign-off, state-by-state rules, auto-publishing fixes.
- **Anti-goals:** a reviewer that flags everything (false flags on compliant ads count against it); findings with no evidence; synthetic test data.

## Approaches considered
1. **Whole-video multimodal call (e.g. Gemini watching the file).** One call, but a black box: no proof which frame triggered a flag, and ~1 fps sampling misses flashed fine print.
2. **Fixed sampling (frame every N s) + one LLM call.** Simple, but it's a script, not an agent, and wastes tokens on dead frames.
3. **Chosen: timestamped transcript + agent-picked frames + extractor → reviewer → fixer.** Whisper gives word/segment timestamps; a frame-picker agent chooses moments (claims spoken, scene cuts, end card where fine print lives) plus a deterministic safety net; separate agents extract claims and judge them against `rules.md`. Every finding carries a timestamp, channel (audio vs on-screen) and frame.

## Stack (user's calls)
- Models: OpenAI. Agents on the **Terra** tier (`gpt-6.1-terra`, env `COMPLIANCE_MODEL`), transcription `whisper-1` (verbose_json, segment + word timestamps). All model calls go through one function in `app/llm.py`, so swapping provider is one change.
- Media: ffmpeg/ffprobe (audio extract, scene detection, frame grabs).
- Backend: **FastAPI** (Python, uv). Frontend: **React** (Vite + TypeScript).

## Pipeline (`backend/app/pipeline.py`)
```
AdInput(text | image | video)
  video: ffmpeg → mono 16 kHz mp3 → whisper-1 → TranscriptSegment[]
         ffmpeg scene detection → cut times
         frame picker agent (transcript + cuts + duration) → ≤ MAX_FRAMES moments w/ reasons
           + safety net: first frame, last 3 s, one per long gap
         ffmpeg → runs/frames/<ad_id>/t<sec>.jpg (768 px)
  → claim extractor agent: every claim + where/when it appears (copy/audio/on_screen_text/visual)
  → reviewer agent: judges claims AND whole-ad omissions (missing/minimised risk info) against rules.md;
     returns verdict + Finding[] (category enum, rule citation, severity, timestamp, frame)
  → fixer agent: suggested_fix per finding (skippable)
  → Report
```
`async def review(ad: AdInput, on_stage: Callable[[Stage], None] | None = None) -> Report`.
Ad content is untrusted: prompts treat transcript / on-screen text as data, never instructions. Structured outputs via Pydantic.

## Golden set (`data/golden/*.jsonl`, all real)
FDA warning-letter quotes (DirectMeds, Hims, BlueChew…), FDA/FTC/NAD cases covering the other violation types, real telehealth video ads (Hims Super Bowl, Ro), DirectMeds image ads from Google Ads Transparency, and FDA-approved-drug TV ads with full safety info as compliant controls. Schema = `GoldenCase` in `app/schemas.py`.
**Must-catch vs optional:** regulator-cited findings are always must-catch; agent-labelled ones are must-catch only when severity is high (explicit `required` overrides). Optional findings are never penalised.

## Scoring (`backend/evals/`)
- A predicted finding matches a golden finding when categories match and, for video with golden timestamps, windows overlap within ±2 s. Each golden finding matches once (greedy, best overlap first).
- Metrics: verdict accuracy (`needs_review` golden accepts `needs_review` or `non_compliant`); must-catch recall; precision (predictions matching any golden finding, required or optional); false flags on compliant controls; timestamp hit rate; per-category recall; latency and tokens.
- **Excerpt rule:** text cases from regulator sources are the lines the regulator quoted, not the whole ad, so omission findings (`missing_risk_information`, `inadequate_disclosure_prominence`) on them are neutral: neither false flags nor counted in precision. They still count on full ads (video, image, real copy).
- A surplus prediction that re-flags an already-matched golden finding is a duplicate, not a false flag. The baseline is the most recent run sharing the most case ids, and regressions are checked on shared cases only.
- Each run is saved to `runs/evals/<run_id>.json` and diffed against the previous run. **Regression** = must-catch recall or verdict accuracy drops by more than 0.05, or false flags on compliant controls rise. CLI exits 1 on regression.

## API (FastAPI, port 8000; Vite proxies `/api` and `/media`)
| Method | Path | Body / returns |
|---|---|---|
| GET | `/api/health` | `{"ok": true, "model": str}` |
| GET | `/api/cases` | `GoldenCase[]` plus `asset_url` (`/media/<asset_path>` or null) |
| GET | `/api/cases/{id}` | `GoldenCase` plus `asset_url` |
| POST | `/api/reviews` | JSON `{"case_id"}` or `{"text"}`, or multipart `file` (+ optional `text`) → `Job` (202) |
| GET | `/api/reviews/{job_id}` | `Job` (UI polls ~1 s; `stage` drives the progress view) |
| POST | `/api/evals` | optional `{"case_ids": [...]}` → `{"run_id"}` (runs in background) |
| GET | `/api/evals/progress` | `{"running": bool, "done": int, "total": int, "run_id": str|null}` |
| GET | `/api/evals/latest` | `EvalRun` (404 if none) |
| GET | `/api/evals` | list of `{run_id, created_at, model, must_catch_recall, verdict_accuracy, precision}` |
| GET | `/media/{path}` | static files from repo root, limited to `data/` and `runs/` |

Reports for golden cases are also cached at `runs/reports/<ad_id>.json` so the UI can show the last review instantly.

## UI (React)
- **Review:** pick a golden case or upload/paste an ad → live stage progress → report: verdict badge, video player with finding markers on the timeline (click to seek), findings list (category, claim, rule, severity, channel, frame thumbnail, suggested fix), transcript with flagged spans, and the golden labels side by side for golden cases.
- **Evals:** scorecard (recall, precision, verdict accuracy, false flags on controls, timestamp hit rate), per-category recall bars, per-case table (missed / false flags), deltas vs the previous run with regressions in red, "Run evals" button with progress.

## Left to the builder
Prompt wording, frame-picker heuristics, UI visual details, concurrency limits.
