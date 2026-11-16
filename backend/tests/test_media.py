"""Light media tests: ffmpeg/ffprobe only, no network. Skips if the sample video or ffmpeg is missing."""

import asyncio
import shutil

import pytest

from app import config, media
from app.pipeline import _merge_moments, _safety_net

VIDEO = config.DATA_DIR / "videos" / "real" / "vid-003" / "video.mp4"
needs_media = pytest.mark.skipif(
    not VIDEO.exists() or shutil.which("ffmpeg") is None, reason="sample video or ffmpeg missing"
)


@needs_media
def test_probe_and_scene_cuts():
    duration, has_audio = asyncio.run(media.probe(VIDEO))
    assert 29 < duration < 31 and has_audio
    cuts = asyncio.run(media.scene_cuts(VIDEO))
    assert cuts and all(0 <= c <= duration for c in cuts)


@needs_media
def test_extract_audio_and_frames(tmp_path):
    mp3 = asyncio.run(media.extract_audio(VIDEO, tmp_path / "a.mp3"))
    assert mp3 is not None and mp3.stat().st_size > 1000
    got = asyncio.run(media.grab_frames(VIDEO, [0.5, 15.0, 30.0], "_test_media", duration=30.05))
    assert set(got) == {0.5, 15.0, 30.0}
    for p in got.values():
        assert (config.REPO_ROOT / p).stat().st_size > 1000
    shutil.rmtree(config.RUNS_DIR / "frames" / "_test_media", ignore_errors=True)


@needs_media
def test_video_without_audio(tmp_path):
    silent = tmp_path / "silent.mp4"
    asyncio.run(media._run("ffmpeg", "-y", "-loglevel", "error", "-i", str(VIDEO), "-t", "2", "-an", str(silent)))
    _, has_audio = asyncio.run(media.probe(silent))
    assert not has_audio
    assert asyncio.run(media.extract_audio(silent, tmp_path / "x.mp3")) is None
    assert asyncio.run(media.transcribe(None)) == []


def test_safety_net_covers_start_end_and_gaps():
    net = _safety_net(30.0, [10.0])
    times = [t for t, _ in net]
    assert times[0] <= 0.5 and max(times) >= 29.0
    assert any(15 < t < 25 for t in times)  # gap 10 -> 27.5 gets filled
    merged = _merge_moments([(1.0, "a"), (1.3, "b"), (5.0, "c")])
    assert [t for t, _ in merged] == [1.0, 5.0]
