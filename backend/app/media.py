"""ffmpeg/ffprobe + whisper helpers for video ads. All subprocesses are async."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from pathlib import Path

from . import cache, config, llm
from .schemas import TranscriptSegment


class MediaError(RuntimeError):
    pass


def abs_path(p: str | Path) -> Path:
    p = Path(p)
    return p if p.is_absolute() else config.REPO_ROOT / p


def rel_path(p: str | Path) -> str:
    """Repo-relative POSIX path (what the UI serves at /media/<path>)."""
    p = Path(p).resolve()
    try:
        return p.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        return p.as_posix()


async def _run(*args: str) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


async def probe(video: str | Path) -> tuple[float, bool]:
    """-> (duration_s, has_audio_stream)."""
    code, out, err = await _run(
        "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
        "-of", "json", str(abs_path(video)),
    )
    if code != 0:
        raise MediaError(f"ffprobe failed: {err.strip()[-300:]}")
    info = json.loads(out or "{}")
    duration = float(info.get("format", {}).get("duration") or 0.0)
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    return duration, has_audio


async def extract_audio(video: str | Path, out_mp3: str | Path) -> Path | None:
    """Mono 16 kHz mp3 for whisper. None if the video has no audio stream."""
    _, has_audio = await probe(video)
    if not has_audio:
        return None
    out = abs_path(out_mp3)
    out.parent.mkdir(parents=True, exist_ok=True)
    code, _, err = await _run(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(abs_path(video)),
        "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", str(out),
    )
    if code != 0 or not out.exists() or out.stat().st_size == 0:
        raise MediaError(f"audio extraction failed: {err.strip()[-300:]}")
    return out


async def transcribe(audio: str | Path | None, usage: dict[str, int] | None = None) -> list[TranscriptSegment]:
    """whisper-1 verbose_json -> segments. Empty list when there's no audio."""
    if audio is None:
        return []
    ck = cache.key("transcribe", config.TRANSCRIBE_MODEL, hashlib.sha256(Path(audio).read_bytes()).hexdigest())
    if (hit := cache.get("transcripts", ck)) is not None:
        if usage is not None:
            usage["cache_hits"] = usage.get("cache_hits", 0) + 1
        return [TranscriptSegment.model_validate(s) for s in json.loads(hit)]
    out = await _transcribe(audio, usage)
    cache.put("transcripts", ck, json.dumps([s.model_dump() for s in out]))
    return out


async def _transcribe(audio: str | Path, usage: dict[str, int] | None) -> list[TranscriptSegment]:
    tr = await llm.transcribe(audio, usage=usage)
    segs = getattr(tr, "segments", None) or []
    out = [
        TranscriptSegment(start=round(float(s.start), 2), end=round(float(s.end), 2), text=s.text.strip())
        for s in segs
        if (s.text or "").strip()
    ]
    if not out and (getattr(tr, "text", "") or "").strip():
        out = [TranscriptSegment(start=0.0, end=float(getattr(tr, "duration", 0) or 0), text=tr.text.strip())]
    return out


async def scene_cuts(video: str | Path, threshold: float = 0.3) -> list[float]:
    """Timestamps (s) where ffmpeg's scene score exceeds `threshold`."""
    code, _, err = await _run(
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(abs_path(video)), "-an",
        "-vf", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-",
    )
    if code != 0:
        raise MediaError(f"scene detection failed: {err.strip()[-300:]}")
    return [round(float(m), 2) for m in re.findall(r"pts_time:([0-9.]+)", err)]


def frame_name(t: float) -> str:
    return f"t{t:06.2f}.jpg"


async def grab_frames(
    video: str | Path, times: list[float], ad_id: str, duration: float | None = None
) -> dict[float, str]:
    """Grab one jpg per time -> runs/frames/<ad_id>/t<sec>.jpg. Returns {t: repo-relative path}."""
    out_dir = config.RUNS_DIR / "frames" / ad_id
    out_dir.mkdir(parents=True, exist_ok=True)
    src = str(abs_path(video))
    sem = asyncio.Semaphore(6)

    async def one(t: float) -> tuple[float, str | None]:
        seek = max(0.0, min(t, (duration - 0.15) if duration else t))
        dest = out_dir / frame_name(t)
        async with sem:
            code, _, _ = await _run(
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{seek:.3f}", "-i", src,
                "-frames:v", "1", "-vf", f"scale={config.FRAME_WIDTH}:-2", "-q:v", "3", str(dest),
            )
        if code != 0 or not dest.exists():
            return t, None
        return t, rel_path(dest)

    results = await asyncio.gather(*(one(t) for t in times))
    return {t: p for t, p in results if p}
