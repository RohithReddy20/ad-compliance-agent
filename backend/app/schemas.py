"""Shared contract between the pipeline, the API, the eval harness and the UI.

Every module codes against these types. Change them only through the lead, and
mirror any change in frontend/src/types.ts.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Category = Literal[
    "false_or_misleading_efficacy",
    "missing_risk_information",
    "compounded_drug_misrepresentation",
    "false_fda_approval_claim",
    "off_label_promotion",
    "unsubstantiated_comparative_claim",
    "misleading_testimonial_or_results",
    "inadequate_disclosure_prominence",
]
Verdict = Literal["non_compliant", "compliant", "needs_review"]
Channel = Literal["copy", "audio", "on_screen_text", "visual"]
Modality = Literal["text", "image", "video"]
Severity = Literal["high", "medium", "low"]
Stage = Literal[
    "queued",
    "extracting_media",
    "transcribing",
    "picking_frames",
    "extracting_claims",
    "reviewing",
    "fixing",
    "done",
    "error",
]

# ---------------------------------------------------------------- pipeline I/O


class AdInput(BaseModel):
    ad_id: str
    modality: Modality
    text: str | None = None  # ad copy for text ads; optional extra copy for media ads
    asset_path: str | None = None  # repo-relative path to the image or video


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class Frame(BaseModel):
    t: float  # seconds into the video
    path: str  # repo-relative; served at /media/<path>
    reason: str  # why the frame picker chose this moment


class Finding(BaseModel):
    category: Category
    claim: str  # verbatim offending words / on-screen text, or a description of the omission
    rule: str  # citation taken from rules.md
    severity: Severity
    rationale: str
    evidence_channel: Channel
    timestamp_s: tuple[float, float] | None = None  # video only
    frame_path: str | None = None  # repo-relative frame that shows it, if any
    suggested_fix: str | None = None


class Report(BaseModel):
    ad_id: str
    modality: Modality
    verdict: Verdict
    summary: str
    findings: list[Finding] = Field(default_factory=list)
    transcript: list[TranscriptSegment] = Field(default_factory=list)
    frames: list[Frame] = Field(default_factory=list)
    model: str
    latency_s: float
    usage: dict[str, int] = Field(default_factory=dict)  # input_tokens, output_tokens


class Job(BaseModel):
    job_id: str
    ad_id: str
    stage: Stage
    error: str | None = None
    report: Report | None = None


# ---------------------------------------------------------------- golden data

REGULATOR_SOURCES = {"fda_letter", "fda_untitled_letter", "ftc_action", "nad_decision"}


class GoldenFinding(BaseModel):
    category: Category
    claim: str
    rule: str = ""
    severity: Severity = "medium"
    timestamp_s: tuple[float, float] | None = None
    evidence_channel: Channel | None = None
    # must-catch vs optional. None -> derived by golden.load_cases():
    # regulator-cited sources are always must-catch; agent-labelled cases are
    # must-catch only when severity == "high". Optional findings are never
    # penalised: missing one costs nothing, flagging one is not a false flag.
    required: bool | None = None


class GoldenCase(BaseModel):
    id: str
    source_type: str
    modality: Modality
    vertical: str
    title: str
    company: str
    source_url: str | None = None
    asset_path: str | None = None
    duration_s: float | None = None
    ad_content: str
    expected_verdict: Verdict
    expected_findings: list[GoldenFinding] = Field(default_factory=list)
    must_not_flag: list[str] = Field(default_factory=list)
    notes: str = ""


# ---------------------------------------------------------------- eval results


class CaseScore(BaseModel):
    case_id: str
    modality: Modality
    expected_verdict: Verdict
    predicted_verdict: Verdict | None
    verdict_ok: bool
    must_catch_total: int
    must_catch_hit: int
    missed: list[str] = Field(default_factory=list)  # "category: claim" of missed must-catch findings
    false_flags: list[str] = Field(default_factory=list)  # predictions matching no golden finding
    timestamp_total: int = 0  # matched video findings with a golden timestamp
    timestamp_hits: int = 0  # ...whose predicted window overlaps the golden one (±2s)
    latency_s: float = 0.0
    error: str | None = None


class EvalRun(BaseModel):
    run_id: str
    created_at: str
    model: str
    n_cases: int
    verdict_accuracy: float
    must_catch_recall: float
    precision: float
    false_flags_on_compliant: int
    timestamp_hit_rate: float | None
    per_category: dict[str, dict[str, float]]  # {category: {"recall": r, "support": n}}
    cases: list[CaseScore]
    baseline_run_id: str | None = None
    deltas: dict[str, float] = Field(default_factory=dict)  # metric -> current minus baseline
    regressions: list[str] = Field(default_factory=list)  # human-readable regression messages
    total_latency_s: float = 0.0
    usage: dict[str, int] = Field(default_factory=dict)
