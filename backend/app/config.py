"""Paths and model settings. One place to swap models or providers."""

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")

DATA_DIR = REPO_ROOT / "data"
GOLDEN_DIR = DATA_DIR / "golden"
RUNS_DIR = REPO_ROOT / "runs"  # reports, extracted frames/audio, eval runs (git-ignored)
RULES_PATH = Path(__file__).resolve().parent / "rules.md"

# OpenAI GPT-6.1 "Terra" tier: between Luna (cheap) and Sol (frontier).
MODEL = os.getenv("COMPLIANCE_MODEL", "gpt-6.1-terra")
# whisper-1 is the transcription model that returns segment/word timestamps (verbose_json).
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "whisper-1")

MAX_FRAMES = int(os.getenv("MAX_FRAMES", "14"))  # cost guardrail per video
FRAME_WIDTH = 768
# Includes reasoning tokens. Long videos produce long claim inventories; too low a cap
# truncates the JSON mid-string (seen on div-007, a 60 s ad).
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "32000"))
