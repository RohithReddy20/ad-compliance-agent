"""Content-addressed cache for model calls and transcripts (runs/cache/, git-ignored).

Off by default, so a review from the live API always really runs. The eval harness
turns it on: a step whose prompt, inputs and model are unchanged is read from disk
and costs nothing, so after a reviewer-prompt change only the reviewer calls re-run.
Pass --no-cache to measure run-to-run variance.
"""

from __future__ import annotations

import hashlib
import json
import os
from contextvars import ContextVar
from typing import Any

from . import config

CACHE_DIR = config.RUNS_DIR / "cache"
enabled: ContextVar[bool] = ContextVar("cache_enabled", default=os.getenv("LLM_CACHE", "0") == "1")


def key(*parts: Any) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(json.dumps(p, sort_keys=True, default=str).encode())
        h.update(b"\x00")
    return h.hexdigest()


def get(namespace: str, k: str) -> str | None:
    if not enabled.get():
        return None
    p = CACHE_DIR / namespace / f"{k}.json"
    return p.read_text() if p.exists() else None


def put(namespace: str, k: str, value: str) -> None:
    if not enabled.get():
        return
    p = CACHE_DIR / namespace / f"{k}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(value)
    tmp.replace(p)
