import asyncio
from types import SimpleNamespace

from pydantic import BaseModel

from app import cache, llm


class Out(BaseModel):
    answer: str


def test_structured_reads_unchanged_calls_from_cache(tmp_path, monkeypatch):
    calls = []

    async def create(**kw):
        calls.append(kw)
        return SimpleNamespace(
            usage=SimpleNamespace(input_tokens=10, output_tokens=2), output_text=Out(answer="x").model_dump_json(), status="completed"
        )

    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(llm, "client", lambda: SimpleNamespace(responses=SimpleNamespace(create=create)))

    async def go():
        cache.enabled.set(True)
        usage: dict[str, int] = {}
        a = await llm.structured(Out, system="s", content="same input", usage=usage)
        b = await llm.structured(Out, system="s", content="same input", usage=usage)
        c = await llm.structured(Out, system="s CHANGED", content="same input", usage=usage)
        return a, b, c, usage

    a, b, c, usage = asyncio.run(go())
    assert a == b == c
    assert len(calls) == 2  # second call was a hit; a changed prompt is a miss
    assert usage["cache_hits"] == 1 and usage["input_tokens"] == 20


def test_cache_is_off_by_default(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    cache.put("llm", "k", "v")
    assert cache.get("llm", "k") is None


def test_content_filter_raises_typed_error_without_retrying(tmp_path, monkeypatch):
    import pytest

    calls = []

    async def create(**kw):
        calls.append(kw)
        return SimpleNamespace(
            usage=SimpleNamespace(input_tokens=10, output_tokens=0), output_text='{"answ',
            status="incomplete", incomplete_details=SimpleNamespace(reason="content_filter"),
        )

    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(llm, "client", lambda: SimpleNamespace(responses=SimpleNamespace(create=create)))
    with pytest.raises(llm.ContentFiltered):
        asyncio.run(llm.structured(Out, system="s", content="c"))
    assert len(calls) == 1
