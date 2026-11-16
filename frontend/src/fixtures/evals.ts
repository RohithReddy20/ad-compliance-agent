// Fixture eval runs for VITE_USE_FIXTURES=1 only. Case ids and must-catch counts follow the
// real golden set (data/golden/*.jsonl); scores are illustrative.

import type { CaseScore, EvalRun, EvalRunSummary } from "../types";

const c = (
  case_id: string,
  modality: CaseScore["modality"],
  expected_verdict: CaseScore["expected_verdict"],
  predicted_verdict: CaseScore["predicted_verdict"],
  verdict_ok: boolean,
  must_catch_total: number,
  must_catch_hit: number,
  latency_s: number,
  extra: Partial<CaseScore> = {},
): CaseScore => ({
  case_id,
  modality,
  expected_verdict,
  predicted_verdict,
  verdict_ok,
  must_catch_total,
  must_catch_hit,
  missed: [],
  false_flags: [],
  timestamp_total: 0,
  timestamp_hits: 0,
  latency_s,
  error: null,
  ...extra,
});

const cases: CaseScore[] = [
  c("fda-001", "text", "non_compliant", "non_compliant", true, 3, 3, 9.8, {
    false_flags: ["false_or_misleading_efficacy: an effective and budget-friendly alternative"],
  }),
  c("fda-002", "text", "non_compliant", "non_compliant", true, 2, 2, 6.1),
  c("fda-003", "text", "non_compliant", "non_compliant", true, 2, 2, 7.4),
  c("fda-004", "text", "non_compliant", "non_compliant", true, 4, 4, 8.9),
  c("fda-005", "text", "non_compliant", "non_compliant", true, 4, 3, 6.6, {
    missed: ["compounded_drug_misrepresentation: TIRZEPATIDE (GENERIC MOUNJARO)"],
  }),
  c("fda-006", "text", "compliant", "compliant", true, 0, 0, 7.9),
  c("img-001", "image", "non_compliant", "non_compliant", true, 1, 1, 14.2),
  c("img-002", "image", "non_compliant", "non_compliant", true, 1, 1, 13.5),
  c("img-003", "image", "non_compliant", "needs_review", false, 2, 1, 12.8, {
    missed: ["misleading_testimonial_or_results: The peptide behind thousands of dramatic skin transformations."],
  }),
  c("vid-005", "video", "compliant", "needs_review", false, 0, 0, 71.3, {
    false_flags: [
      "misleading_testimonial_or_results: People taking Wegovy pill lost over 30 lb, and some lost over 47 lb.",
    ],
  }),
  c("vid-006", "video", "compliant", "compliant", true, 0, 0, 84.0),
  c("vid-001", "video", "non_compliant", "non_compliant", true, 4, 4, 62.4, {
    false_flags: ["unsubstantiated_comparative_claim: A $160 billion industry that feeds on our failure."],
    timestamp_total: 5,
    timestamp_hits: 5,
  }),
  c("vid-002", "video", "needs_review", "non_compliant", true, 0, 0, 38.2, {
    timestamp_total: 3,
    timestamp_hits: 2,
  }),
  c("vid-003", "video", "non_compliant", "non_compliant", true, 2, 2, 36.9, {
    timestamp_total: 4,
    timestamp_hits: 3,
  }),
  c("vid-004", "video", "compliant", "compliant", true, 0, 0, 22.1),
];

export const fixtureLatestRun: EvalRun = {
  run_id: "20261117-0214-a3f9",
  created_at: "2026-11-17T02:14:08Z",
  model: "gpt-6.1-terra",
  n_cases: cases.length,
  verdict_accuracy: 13 / 15,
  must_catch_recall: 23 / 25,
  precision: 0.81,
  false_flags_on_compliant: 1,
  timestamp_hit_rate: 10 / 12,
  per_category: {
    compounded_drug_misrepresentation: { recall: 15 / 16, support: 16 },
    missing_risk_information: { recall: 1, support: 3 },
    false_or_misleading_efficacy: { recall: 1, support: 2 },
    inadequate_disclosure_prominence: { recall: 1, support: 2 },
    unsubstantiated_comparative_claim: { recall: 1, support: 1 },
    misleading_testimonial_or_results: { recall: 0, support: 1 },
    off_label_promotion: { recall: 0.5, support: 2 },
    false_fda_approval_claim: { recall: 0, support: 0 },
  },
  cases,
  baseline_run_id: "20261116-2241-7c02",
  deltas: {
    must_catch_recall: 0.08,
    verdict_accuracy: -0.067,
    precision: 0.05,
    false_flags_on_compliant: 1,
    timestamp_hit_rate: 0.083,
    total_latency_s: -38.2,
  },
  regressions: [
    "verdict_accuracy fell from 0.933 to 0.867 (−0.067)",
    "false flags on compliant controls rose from 0 to 1 (vid-005)",
  ],
  total_latency_s: 402.1,
  usage: { input_tokens: 312480, output_tokens: 28644 },
};

export const fixtureRunHistory: EvalRunSummary[] = [
  {
    run_id: fixtureLatestRun.run_id,
    created_at: fixtureLatestRun.created_at,
    model: "gpt-6.1-terra",
    must_catch_recall: 23 / 25,
    verdict_accuracy: 13 / 15,
    precision: 0.81,
  },
  {
    run_id: "20261116-2241-7c02",
    created_at: "2026-11-16T22:41:33Z",
    model: "gpt-6.1-terra",
    must_catch_recall: 0.84,
    verdict_accuracy: 14 / 15,
    precision: 0.76,
  },
  {
    run_id: "20261116-1905-19bd",
    created_at: "2026-11-16T19:05:12Z",
    model: "gpt-6.1-terra",
    must_catch_recall: 0.72,
    verdict_accuracy: 0.8,
    precision: 0.69,
  },
  {
    run_id: "20261116-1530-e4d1",
    created_at: "2026-11-16T15:30:47Z",
    model: "gpt-6.1-luna",
    must_catch_recall: 0.6,
    verdict_accuracy: 0.733,
    precision: 0.58,
  },
];
