"""FastAPI app: golden cases, review jobs, eval runs, media.

    uv run uvicorn app.main:app --port 8000
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.datastructures import UploadFile

from app import config
from app.golden import get_case, load_cases
from app.schemas import AdInput, EvalRun, GoldenCase, Job, Modality, Report
from evals import run_eval as evals

log = logging.getLogger("app")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Telehealth Ad Compliance Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
TEXT_EXT = {".txt", ".md"}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
EVAL_CONCURRENCY = int(os.getenv("EVAL_CONCURRENCY", "4"))

JOBS: dict[str, Job] = {}
EVAL_STATE: dict[str, Any] = {"running": False, "done": 0, "total": 0, "run_id": None, "error": None}
_TASKS: set[asyncio.Task] = set()  # keep strong refs so background tasks aren't GC'd


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


def _case_out(case: GoldenCase) -> dict:
    return {**case.model_dump(), "asset_url": f"/media/{case.asset_path}" if case.asset_path else None}


def _repo_rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(config.REPO_ROOT.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


# ---------------------------------------------------------------- cases


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "model": config.MODEL}


@app.get("/api/cases")
def list_cases() -> list[dict]:
    return [_case_out(c) for c in load_cases()]


@app.get("/api/cases/{case_id}")
def read_case(case_id: str) -> dict:
    case = get_case(case_id)
    if case is None:
        raise HTTPException(404, f"case {case_id} not found")
    return _case_out(case)


# ---------------------------------------------------------------- reviews


async def _run_job(job: Job, ad: AdInput) -> None:
    def on_stage(stage) -> None:
        job.stage = stage

    try:
        report = await evals.pipeline().review(ad, on_stage=on_stage)
        evals.save_report(report)
        job.report = report
        job.stage = "done"
    except Exception as e:  # noqa: BLE001 - surface any pipeline failure to the UI
        log.exception("review job %s failed", job.job_id)
        job.error = f"{type(e).__name__}: {e}"
        job.stage = "error"


async def _ad_from_upload(upload: UploadFile, text: str | None) -> AdInput:
    name = Path(upload.filename or "upload").name
    ext = Path(name).suffix.lower()
    uid = uuid.uuid4().hex[:8]
    data = await upload.read()
    if not data:
        raise HTTPException(400, "uploaded file is empty")
    if ext in TEXT_EXT:
        body = data.decode("utf-8", errors="replace")
        return AdInput(ad_id=f"upload-{uid}", modality="text", text="\n\n".join(t for t in (body, text) if t))
    modality: Modality
    if ext in IMAGE_EXT:
        modality = "image"
    elif ext in VIDEO_EXT:
        modality = "video"
    else:
        raise HTTPException(400, f"unsupported file type {ext or '(none)'}; use an image, video or .txt")
    dest_dir = config.RUNS_DIR / "uploads"
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    dest = dest_dir / f"{uid}_{safe}"
    dest.write_bytes(data)
    return AdInput(ad_id=f"upload-{uid}", modality=modality, text=text or None, asset_path=_repo_rel(dest))


@app.post("/api/reviews", status_code=202, response_model=Job)
async def create_review(request: Request) -> Job:
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        text = form.get("text")
        text = text.strip() if isinstance(text, str) and text.strip() else None
        if isinstance(upload, UploadFile):
            ad = await _ad_from_upload(upload, text)
        elif text:
            ad = AdInput(ad_id=f"text-{uuid.uuid4().hex[:8]}", modality="text", text=text)
        else:
            raise HTTPException(400, "multipart request needs a 'file' (and/or 'text')")
    else:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            raise HTTPException(400, 'send JSON {"case_id"} or {"text"}, or a multipart file')
        if not isinstance(body, dict):
            raise HTTPException(400, "JSON body must be an object")
        if body.get("case_id"):
            case = get_case(str(body["case_id"]))
            if case is None:
                raise HTTPException(404, f"case {body['case_id']} not found")
            ad = evals.to_ad_input(case)
        elif isinstance(body.get("text"), str) and body["text"].strip():
            ad = AdInput(ad_id=f"text-{uuid.uuid4().hex[:8]}", modality="text", text=body["text"].strip())
        else:
            raise HTTPException(400, 'JSON body needs "case_id" or "text"')

    job = Job(job_id=uuid.uuid4().hex, ad_id=ad.ad_id, stage="queued")
    JOBS[job.job_id] = job
    _spawn(_run_job(job, ad))
    return job


@app.get("/api/reviews/{job_id}", response_model=Job)
def read_review(job_id: str) -> Job:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} not found")
    return job


@app.get("/api/reports/{ad_id}", response_model=Report)
def read_report(ad_id: str) -> Report:
    path = evals.reports_dir() / f"{ad_id}.json"
    if not SAFE_ID.match(ad_id) or not path.is_file():
        raise HTTPException(404, f"no cached report for {ad_id}")
    return Report.model_validate_json(path.read_text())


# ---------------------------------------------------------------- evals


async def _run_evals(case_ids: list[str] | None, run_id: str) -> None:
    def progress(done: int, total: int) -> None:
        EVAL_STATE.update(done=done, total=total)

    try:
        await evals.run_eval(case_ids, EVAL_CONCURRENCY, progress, run_id=run_id)
    except Exception as e:  # noqa: BLE001
        log.exception("eval run %s failed", run_id)
        EVAL_STATE["error"] = f"{type(e).__name__}: {e}"
    finally:
        EVAL_STATE["running"] = False


@app.post("/api/evals", status_code=202)
async def start_evals(request: Request) -> dict:
    if EVAL_STATE["running"]:
        raise HTTPException(409, f"eval run {EVAL_STATE['run_id']} is already running")
    raw = await request.body()
    body: Any = {}
    if raw.strip():
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            raise HTTPException(400, "body must be JSON")
    case_ids = body.get("case_ids") if isinstance(body, dict) else None
    known = {c.id for c in load_cases()}
    if case_ids:
        if not isinstance(case_ids, list) or not all(isinstance(c, str) for c in case_ids):
            raise HTTPException(400, "case_ids must be a list of strings")
        unknown = set(case_ids) - known
        if unknown:
            raise HTTPException(400, f"unknown case ids: {', '.join(sorted(unknown))}")
    else:
        case_ids = None
    run_id = evals.new_run_id()
    EVAL_STATE.update(running=True, done=0, total=len(case_ids or known), run_id=run_id, error=None)
    _spawn(_run_evals(case_ids, run_id))
    return {"run_id": run_id}


@app.get("/api/evals/progress")
def eval_progress() -> dict:
    return dict(EVAL_STATE)


@app.get("/api/evals/latest", response_model=EvalRun)
def latest_eval() -> EvalRun:
    runs = evals.list_runs()
    if not runs:
        raise HTTPException(404, "no eval runs yet")
    return runs[0]


@app.get("/api/evals")
def list_evals() -> list[dict]:
    keys = ("run_id", "created_at", "model", "must_catch_recall", "verdict_accuracy", "precision")
    return [{k: getattr(r, k) for k in keys} for r in evals.list_runs()]


@app.get("/api/evals/{run_id}", response_model=EvalRun)
def read_eval(run_id: str) -> EvalRun:
    path = evals.evals_dir() / f"{run_id}.json"
    if not SAFE_ID.match(run_id) or not path.is_file():
        raise HTTPException(404, f"eval run {run_id} not found")
    return EvalRun.model_validate_json(path.read_text())


# ---------------------------------------------------------------- media


@app.get("/media/{path:path}")
def media(path: str) -> FileResponse:
    root = config.REPO_ROOT.resolve()
    target = (root / path).resolve()
    allowed = [config.DATA_DIR.resolve(), config.RUNS_DIR.resolve()]
    if not any(target.is_relative_to(a) for a in allowed):
        raise HTTPException(403, "media is limited to data/ and runs/")
    if not target.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(target)
