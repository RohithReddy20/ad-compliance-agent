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
Three screens, each built round the one question a reviewer has on it.
- **Ad library** (`#/`): every golden ad as a card (video poster, image, or opening lines of the copy) with the expected verdict beside the agent's last verdict. Filter by format, search, or start a new ad.
- **Review workspace** (`#/review/<id>`, `#/review/new`): the answer first, then the evidence.
  - Status strip across the top: not reviewed / live stage progress / verdict with summary and the golden-label check.
  - Left, fixed: the ad. Video with the line being spoken and a timeline (frames the agent examined, findings per channel; select to seek); image; or copy with flagged passages underlined.
  - Right, scrolling: tabs for Findings (one row each, the open one shows claim, suggested rewrite, rationale, rule, frame), Golden labels, Transcript and Case notes. J / K steps through findings.
- **Evals** (`#/evals`): the gate result as the headline; the three gate metrics large (must-catch recall, verdict accuracy, false flags on clean ads) with deltas; supporting metrics; results by ad (filter to those needing attention, expand a row for missed and false flags); recall by category; run history.

Theme: a puppet-maker's workbench (bone, oxblood, soot on a grey studio wall). The "Inspector" puppet shows state on its face: reading while a review runs, then the verdict. Materials are decoration only; text contrast, focus rings, keyboard access and plain labels come first.

## Left to the builder
Prompt wording, frame-picker heuristics, UI visual details, concurrency limits.
