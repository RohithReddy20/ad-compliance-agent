import asyncio
import sys
import time
import types

import pytest
from fastapi.testclient import TestClient

from app import config, main
from app.golden import load_cases
from app.schemas import AdInput, Finding, GoldenCase, Report

STAGES = ["extracting_claims", "reviewing", "fixing"]


def make_fake_pipeline(fail_ids=()):
    mod = types.ModuleType("app.pipeline")

    async def review(ad: AdInput, on_stage=None, **_kw) -> Report:
        for stage in STAGES:
            if on_stage:
                on_stage(stage)
            await asyncio.sleep(0.01)
        if ad.ad_id in fail_ids:
            raise RuntimeError("model exploded")
        findings = []
        if "compounded" in (ad.text or "").lower() and ad.ad_id != "fda-006":  # fda-006 is a compliant control
            findings.append(
                Finding(
                    category="compounded_drug_misrepresentation",
                    claim="same active ingredient",
                    rule="rules.md §3",
                    severity="high",
                    rationale="compounded drugs are not FDA approved",
                    evidence_channel="copy",
                )
            )
        return Report(
            ad_id=ad.ad_id,
            modality=ad.modality,
            verdict="non_compliant" if findings else "compliant",
            summary="fake",
            findings=findings,
            model="fake-model",
            latency_s=0.05,
            usage={"input_tokens": 100, "output_tokens": 20},
        )

    def review_case(case: GoldenCase) -> AdInput:
        return AdInput(ad_id=case.id, modality=case.modality, text=case.ad_content, asset_path=case.asset_path)

    mod.review = review
    mod.review_case = review_case
    return mod


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "app.pipeline", make_fake_pipeline(fail_ids={"fda-002"}))
    monkeypatch.setattr(config, "RUNS_DIR", tmp_path / "runs")
    main.JOBS.clear()
    main.EVAL_STATE.update(running=False, done=0, total=0, run_id=None, error=None)
    with TestClient(main.app) as c:
        yield c


def wait_for(client, url, done, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(url).json()
        if done(body):
            return body
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting on {url}: {body}")


# ---------------------------------------------------------------- cases


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["model"]


def test_cases_list_has_all_golden_cases_and_asset_urls(client):
    r = client.get("/api/cases")
    assert r.status_code == 200
    cases = r.json()
    assert {c["id"] for c in cases} == {c.id for c in load_cases()}
    for c in cases:
        assert c["asset_url"] == (f"/media/{c['asset_path']}" if c["asset_path"] else None)
        for f in c["expected_findings"]:
            assert f["required"] in (True, False)  # resolved by golden.load_cases


def test_required_resolution():
    cases = {c.id: c for c in load_cases()}
    assert all(f.required for f in cases["fda-001"].expected_findings)  # regulator source
    img = cases["img-001"].expected_findings
    assert img[0].required is False  # explicit value wins
    assert [f.required for f in img[1:]] == [f.severity == "high" for f in img[1:]]


def test_invalid_golden_lines_are_skipped(monkeypatch, tmp_path):
    good = load_cases()[0].model_dump_json()
    (tmp_path / "a.jsonl").write_text(f"{good}\nnot json\n{{\"id\": \"x\"}}\n\n")
    monkeypatch.setattr(config, "GOLDEN_DIR", tmp_path)
    assert len(load_cases()) == 1


def test_case_detail_and_404(client):
    r = client.get("/api/cases/vid-001")
    assert r.status_code == 200 and r.json()["asset_url"] == "/media/data/videos/real/vid-001/video.mp4"
    assert client.get("/api/cases/nope").status_code == 404


# ---------------------------------------------------------------- reviews


def test_review_job_lifecycle_for_golden_case(client):
    r = client.post("/api/reviews", json={"case_id": "fda-001"})
    assert r.status_code == 202
    job = r.json()
    assert job["ad_id"] == "fda-001" and job["stage"] in ["queued", *STAGES]
    final = wait_for(client, f"/api/reviews/{job['job_id']}", lambda b: b["stage"] in ("done", "error"))
    assert final["stage"] == "done" and final["report"]["verdict"] == "non_compliant"
    cached = client.get("/api/reports/fda-001")
    assert cached.status_code == 200 and cached.json()["ad_id"] == "fda-001"


def test_review_text_and_error_job(client):
    r = client.post("/api/reviews", json={"text": "Our compounded semaglutide is the same as Wegovy"})
    assert r.status_code == 202
    final = wait_for(client, f"/api/reviews/{r.json()['job_id']}", lambda b: b["stage"] in ("done", "error"))
    assert final["report"]["modality"] == "text"

    r = client.post("/api/reviews", json={"case_id": "fda-002"})  # fake pipeline fails this one
    final = wait_for(client, f"/api/reviews/{r.json()['job_id']}", lambda b: b["stage"] in ("done", "error"))
    assert final["stage"] == "error" and "model exploded" in final["error"]


def test_review_upload(client):
    r = client.post("/api/reviews", files={"file": ("ad.png", b"\x89PNG fake", "image/png")}, data={"text": "extra"})
    assert r.status_code == 202
    final = wait_for(client, f"/api/reviews/{r.json()['job_id']}", lambda b: b["stage"] == "done")
    assert final["report"]["modality"] == "image"
    assert list((config.RUNS_DIR / "uploads").iterdir())
    assert client.post("/api/reviews", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400


def test_review_bad_requests(client):
    assert client.post("/api/reviews", json={}).status_code == 400
    assert client.post("/api/reviews", json={"case_id": "nope"}).status_code == 404
    assert client.get("/api/reviews/nope").status_code == 404
    assert client.get("/api/reports/never-reviewed").status_code == 404


# ---------------------------------------------------------------- media


def test_media_serves_data_files(client):
    r = client.get("/media/data/golden/fda_letters.jsonl")
    assert r.status_code == 200 and b"fda-001" in r.content


@pytest.mark.parametrize(
    "path",
    [
        "/media/.env",
        "/media/data/%2e%2e/.env",
        "/media/data/..%2F.env",
        "/media/%2e%2e/%2e%2e/etc/passwd",
        "/media/backend/app/config.py",
        "/media/%2Fetc%2Fpasswd",
    ],
)
def test_media_rejects_traversal(client, path):
    r = client.get(path)
    assert r.status_code in (403, 404)
    assert b"OPENAI" not in r.content and b"root:" not in r.content


# ---------------------------------------------------------------- evals


def test_evals_lifecycle(client):
    assert client.get("/api/evals/latest").status_code == 404
    assert client.get("/api/evals").json() == []

    r = client.post("/api/evals", json={"case_ids": ["fda-001", "fda-002", "fda-006"]})
    assert r.status_code == 202
    run_id = r.json()["run_id"]
    assert client.post("/api/evals", json={}).status_code == 409  # one at a time

    prog = wait_for(client, "/api/evals/progress", lambda b: not b["running"])
    assert prog["run_id"] == run_id and prog["done"] == prog["total"] == 3 and prog["error"] is None

    latest = client.get("/api/evals/latest").json()
    assert latest["run_id"] == run_id and latest["n_cases"] == 3
    by_id = {c["case_id"]: c for c in latest["cases"]}
    assert by_id["fda-002"]["error"]  # failed case recorded, run survived
    assert by_id["fda-006"]["verdict_ok"]
    assert latest["baseline_run_id"] is None

    summaries = client.get("/api/evals").json()
    assert summaries[0]["run_id"] == run_id
    assert set(summaries[0]) == {"run_id", "created_at", "model", "must_catch_recall", "verdict_accuracy", "precision"}
    assert (config.RUNS_DIR / "reports" / "fda-001.json").exists()
    assert client.get(f"/api/evals/{run_id}").status_code == 200


def test_evals_unknown_case_is_400(client):
    assert client.post("/api/evals", json={"case_ids": ["nope"]}).status_code == 400


def test_second_run_diffs_against_first(client):
    import json

    from evals.run_eval import run_eval

    first = asyncio.run(run_eval(["fda-001", "fda-006"], concurrency=2))
    second = asyncio.run(run_eval(["fda-001", "fda-006"], concurrency=2))
    assert first.run_id != second.run_id
    assert second.baseline_run_id == first.run_id and second.regressions == []
    saved = json.loads((config.RUNS_DIR / "evals" / f"{second.run_id}.json").read_text())
    assert saved["baseline_run_id"] == first.run_id
