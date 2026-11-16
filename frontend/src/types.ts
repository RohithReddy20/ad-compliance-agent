// Mirror of backend/app/schemas.py. Change only together with the backend contract.

export type Category =
  | "false_or_misleading_efficacy"
  | "missing_risk_information"
  | "compounded_drug_misrepresentation"
  | "false_fda_approval_claim"
  | "off_label_promotion"
  | "unsubstantiated_comparative_claim"
  | "misleading_testimonial_or_results"
  | "inadequate_disclosure_prominence";

export type Verdict = "non_compliant" | "compliant" | "needs_review";
export type Channel = "copy" | "audio" | "on_screen_text" | "visual";
export type Modality = "text" | "image" | "video";
export type Severity = "high" | "medium" | "low";
export type Stage =
  | "queued"
  | "extracting_media"
  | "transcribing"
  | "picking_frames"
  | "extracting_claims"
  | "reviewing"
  | "fixing"
  | "done"
  | "error";

// ---------------------------------------------------------------- pipeline I/O

export interface AdInput {
  ad_id: string;
  modality: Modality;
  text: string | null;
  asset_path: string | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Frame {
  t: number;
  path: string; // repo-relative; served at /media/<path>
  reason: string;
}

export interface Finding {
  category: Category;
  claim: string;
  rule: string;
  severity: Severity;
  rationale: string;
  evidence_channel: Channel;
  timestamp_s: [number, number] | null;
  frame_path: string | null;
  suggested_fix: string | null;
}

export interface Report {
  ad_id: string;
  modality: Modality;
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  transcript: TranscriptSegment[];
  frames: Frame[];
  model: string;
  latency_s: number;
  usage: Record<string, number>;
}

export interface Job {
  job_id: string;
  ad_id: string;
  stage: Stage;
  error: string | null;
  report: Report | null;
}

// ---------------------------------------------------------------- golden data

export const REGULATOR_SOURCES = new Set([
  "fda_letter",
  "fda_untitled_letter",
  "ftc_action",
  "nad_decision",
]);

export interface GoldenFinding {
  category: Category;
  claim: string;
  rule: string;
  severity: Severity;
  timestamp_s: [number, number] | null;
  evidence_channel: Channel | null;
  required: boolean | null;
}

export interface GoldenCase {
  id: string;
  source_type: string;
  modality: Modality;
  vertical: string;
  title: string;
  company: string;
  source_url: string | null;
  asset_path: string | null;
  duration_s: number | null;
  ad_content: string;
  expected_verdict: Verdict;
  expected_findings: GoldenFinding[];
  must_not_flag: string[];
  notes: string;
}

/** GET /api/cases and /api/cases/{id} add the media URL. */
export interface CaseWithAsset extends GoldenCase {
  asset_url: string | null;
}

// ---------------------------------------------------------------- eval results

export interface CaseScore {
  case_id: string;
  modality: Modality;
  expected_verdict: Verdict;
  predicted_verdict: Verdict | null;
  verdict_ok: boolean;
  must_catch_total: number;
  must_catch_hit: number;
  missed: string[];
  false_flags: string[];
  timestamp_total: number;
  timestamp_hits: number;
  latency_s: number;
  error: string | null;
}

export interface EvalRun {
  run_id: string;
  created_at: string;
  model: string;
  n_cases: number;
  verdict_accuracy: number;
  must_catch_recall: number;
  precision: number;
  false_flags_on_compliant: number;
  timestamp_hit_rate: number | null;
  per_category: Record<string, { recall: number; support: number }>;
  cases: CaseScore[];
  baseline_run_id: string | null;
  deltas: Record<string, number>;
  regressions: string[];
  total_latency_s: number;
  usage: Record<string, number>;
}

// ---------------------------------------------------------------- API envelopes

export interface Health {
  ok: boolean;
  model: string;
}

export interface EvalProgress {
  running: boolean;
  done: number;
  total: number;
  run_id: string | null;
  error?: string | null;
}

export interface EvalRunSummary {
  run_id: string;
  created_at: string;
  model: string;
  must_catch_recall: number;
  verdict_accuracy: number;
  precision: number;
}

export type ReviewRequest =
  | { kind: "case"; case_id: string }
  | { kind: "text"; text: string }
  | { kind: "file"; file: File; text?: string };
