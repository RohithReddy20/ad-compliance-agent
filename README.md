# Telehealth Ad Compliance Agent

A multi-agent reviewer for telehealth ads, covering text, image and video. It flags claims that could break FDA/FTC or ad-platform rules. Every flag cites a rule, quotes the claim verbatim and, for video, points to the timestamp and frame where it appears. It then suggests compliant wording. An eval harness built on real regulator cases scores every change and catches regressions.

Findings are **flagged for human review**, never legal conclusions.

## How it works

```
AdInput (text | image | video)
  video: ffmpeg → mono 16 kHz audio → whisper-1 → timestamped transcript
         ffmpeg scene detection → cut times
         frame-picker agent → chooses moments (claims spoken, scene cuts, end-card fine print)
           + deterministic safety net (first frame, last 3 s, long gaps)
  → claim extractor agent   every claim + where it appears (copy / audio / on-screen / visual)
  → reviewer agent          judges claims and omissions against rules.md, with citations
  → fixer agent             suggested compliant rewrite per finding
  → Report
```

- **One model boundary.** All model calls go through `backend/app/llm.py`, so switching providers is a one-file change.
- **One contract.** `backend/app/schemas.py` defines the shared types. It is mirrored in `frontend/src/types.ts`.
- **Ad content is untrusted.** Prompts treat transcripts and on-screen text as data, never as instructions.

## Evals

`data/golden/*.jsonl` holds the golden set, and every case is real:
- claims quoted in FDA warning letters to telehealth firms
- FTC and NAD decisions
- real telehealth video ads
- image ads from the Google Ads Transparency Center
- compliant controls: TV ads for FDA-approved drugs that carry full safety info

The eval reports these metrics: verdict accuracy, must-catch recall, precision, false flags on compliant controls, and timestamp hit rate. Each run is diffed against the last one, and the CLI **exits 1 on regression**.

## Run it

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 20+, ffmpeg, and an OpenAI API key.

```bash
cp .env.example .env            # add OPENAI_API_KEY

# API
cd backend && uv run uvicorn app.main:app --reload --port 8000

# UI (proxies /api and /media to :8000)
cd frontend && npm install && npm run dev

# Review one golden case / run evals / tests
cd backend && uv run python -m app.pipeline <case_id>
cd backend && uv run python -m evals.run_eval [--cases a,b]
cd backend && uv run pytest
```

Media files (videos and image ads) are not committed. Each golden case lists its `source_url`. Download the file to the case's `asset_path` under `data/videos/` or `data/images/`.

## Layout

| Path | What |
|---|---|
| `backend/app/pipeline.py` | Orchestration: media → transcript → frames → agents → report |
| `backend/app/agents.py` | Frame picker, extractor, reviewer, fixer |
| `backend/app/media.py` | ffmpeg / ffprobe helpers |
| `backend/app/rules.md` | Rule base the reviewer must cite |
| `backend/app/main.py` | FastAPI service |
| `backend/evals/` | Scoring and regression gate |
| `frontend/` | React (Vite + TS) review and evals UI |
| `docs/superpowers/specs/` | Design doc |
| `CLAUDE.md` | Agent instructions used while building |

Built with Claude Code.
