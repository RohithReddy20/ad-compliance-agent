"""The one place model calls happen. Swap provider here.

- `structured()` -> a Pydantic model via the OpenAI Responses API structured outputs,
  with optional image inputs (local jpg/png paths or data URLs).
- `transcribe()` -> whisper verbose_json with segment + word timestamps.
Both add token usage into a caller-supplied dict and retry transient errors.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
from pathlib import Path
from typing import Any, TypeVar

import openai
from openai import AsyncOpenAI
from openai.lib._parsing._responses import type_to_text_format_param  # strict JSON schema, as parse() uses
from pydantic import BaseModel, ValidationError

from . import cache, config

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class ContentFiltered(RuntimeError):
    """The provider's safety filter stopped the output. Not retried: it's consistent for the
    same input. The pipeline turns this into a needs_review report, never a pass."""

_clients: dict[int, AsyncOpenAI] = {}
_TRANSIENT = (
    openai.APIConnectionError,
    openai.APITimeoutError,
    openai.RateLimitError,
    openai.InternalServerError,
)


def client() -> AsyncOpenAI:
    """One client per event loop (httpx pools are loop-bound; callers may asyncio.run repeatedly)."""
    try:
        key = id(asyncio.get_running_loop())
    except RuntimeError:
        key = 0
    if key not in _clients:
        if len(_clients) > 8:
            _clients.clear()
        _clients[key] = AsyncOpenAI(max_retries=3, timeout=180)
    return _clients[key]


def image_data_url(path_or_url: str | Path) -> str:
    """Local jpg/png path -> base64 data URL (data URLs pass through)."""
    s = str(path_or_url)
    if s.startswith("data:") or s.startswith("http"):
        return s
    p = Path(s)
    if not p.is_absolute():
        p = config.REPO_ROOT / p
    mime = mimetypes.guess_type(p.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


def add_usage(usage: dict[str, int] | None, input_tokens: int, output_tokens: int) -> None:
    if usage is None:
        return
    usage["input_tokens"] = usage.get("input_tokens", 0) + int(input_tokens or 0)
    usage["output_tokens"] = usage.get("output_tokens", 0) + int(output_tokens or 0)
    usage["llm_calls"] = usage.get("llm_calls", 0) + 1


async def structured(
    output: type[T],
    *,
    system: str,
    content: list[str | dict[str, Any]] | str,
    images: list[tuple[str, str | Path]] | None = None,
    usage: dict[str, int] | None = None,
    model: str | None = None,
    effort: str | None = "low",
    image_detail: str = "high",
    attempts: int = 3,
) -> T:
    """Call the model and parse its reply into `output`.

    content: user text (or list of text chunks / raw input parts).
    images: list of (label, path_or_data_url); each label is sent as text just
            before its image so the model can refer to it (e.g. "frame t=12.0s").
    """
    parts: list[dict[str, Any]] = []
    for c in [content] if isinstance(content, str) else content:
        parts.append({"type": "input_text", "text": c} if isinstance(c, str) else c)
    for label, img in images or []:
        parts.append({"type": "input_text", "text": label})
        parts.append({"type": "input_image", "image_url": image_data_url(img), "detail": image_detail})

    kwargs: dict[str, Any] = {}
    if effort:
        kwargs["reasoning"] = {"effort": effort}

    ck = cache.key(
        "structured", model or config.MODEL, system, parts, output.model_json_schema(), effort, image_detail
    )
    if (hit := cache.get("llm", ck)) is not None:
        if usage is not None:
            usage["cache_hits"] = usage.get("cache_hits", 0) + 1
        return output.model_validate_json(hit)

    last_err: Exception | None = None
    for attempt in range(attempts):
        try:
            # create() + our own validation (not parse()) so we can see *why* an output is
            # incomplete before JSON parsing fails on it.
            resp = await client().responses.create(
                model=model or config.MODEL,
                instructions=system,
                input=[{"role": "user", "content": parts}],
                text={"format": type_to_text_format_param(output)},
                store=False,
                max_output_tokens=config.MAX_OUTPUT_TOKENS,
                **kwargs,
            )
            if resp.usage:
                add_usage(usage, resp.usage.input_tokens, resp.usage.output_tokens)
            if resp.status == "incomplete":
                reason = getattr(getattr(resp, "incomplete_details", None), "reason", "unknown")
                if reason == "content_filter":
                    raise ContentFiltered(f"{output.__name__}: output blocked by the provider's content filter")
                raise ValueError(f"incomplete output ({reason})")
            parsed = output.model_validate_json(resp.output_text)
            cache.put("llm", ck, parsed.model_dump_json())
            return parsed
        except (*_TRANSIENT, ValidationError, ValueError) as e:
            last_err = e
            log.warning("llm.structured %s attempt %d failed: %s", output.__name__, attempt + 1, e)
            await asyncio.sleep(1.5 * (attempt + 1))
        except openai.BadRequestError as e:
            # Some models reject the reasoning param; retry once without it.
            if "reasoning" in kwargs and "reasoning" in str(e).lower():
                kwargs.pop("reasoning")
                last_err = e
                continue
            raise
    raise RuntimeError(f"model call for {output.__name__} failed after {attempts} attempts: {last_err}")


async def transcribe(audio_path: str | Path, usage: dict[str, int] | None = None, attempts: int = 3):
    """whisper verbose_json with segment + word timestamps. Returns the SDK object."""
    last_err: Exception | None = None
    for attempt in range(attempts):
        try:
            with open(audio_path, "rb") as f:
                tr = await client().audio.transcriptions.create(
                    file=f,
                    model=config.TRANSCRIBE_MODEL,
                    response_format="verbose_json",
                    timestamp_granularities=["segment", "word"],
                )
            if usage is not None:
                usage["audio_seconds"] = usage.get("audio_seconds", 0) + int(round(getattr(tr, "duration", 0) or 0))
            return tr
        except _TRANSIENT as e:
            last_err = e
            log.warning("transcribe attempt %d failed: %s", attempt + 1, e)
            await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"transcription failed after {attempts} attempts: {last_err}")
