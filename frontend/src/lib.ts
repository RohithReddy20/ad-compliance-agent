import type {
  Category,
  Channel,
  Finding,
  GoldenCase,
  GoldenFinding,
  Modality,
  Severity,
  Stage,
  Verdict,
} from "./types";
import { REGULATOR_SOURCES } from "./types";

export const CATEGORY_LABEL: Record<Category, string> = {
  false_or_misleading_efficacy: "Misleading efficacy",
  missing_risk_information: "Missing risk information",
  compounded_drug_misrepresentation: "Compounded drug misrepresentation",
  false_fda_approval_claim: "False FDA-approval claim",
  off_label_promotion: "Off-label promotion",
  unsubstantiated_comparative_claim: "Unsubstantiated comparison",
  misleading_testimonial_or_results: "Misleading testimonial / results",
  inadequate_disclosure_prominence: "Disclosure not prominent",
};

export const categoryLabel = (c: string): string => CATEGORY_LABEL[c as Category] ?? humanize(c);

export const CHANNEL_LABEL: Record<Channel, string> = {
  copy: "Copy",
  audio: "Audio",
  on_screen_text: "On-screen text",
  visual: "Visual",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  non_compliant: "Non-compliant",
  needs_review: "Needs review",
  compliant: "Compliant",
};

export const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

export const MODALITY_LABEL: Record<Modality, string> = { text: "Text", image: "Image", video: "Video" };

export const SOURCE_LABEL: Record<string, string> = {
  fda_letter: "FDA warning letter",
  fda_untitled_letter: "FDA untitled letter",
  ftc_action: "FTC action",
  nad_decision: "NAD decision",
  real_copy: "Published copy",
  real_image_ad: "Image ad",
  real_video: "Video ad",
};

export const STAGE_LABEL: Record<Stage, string> = {
  queued: "Queued",
  extracting_media: "Extracting media",
  transcribing: "Transcribing",
  picking_frames: "Picking frames",
  extracting_claims: "Extracting claims",
  reviewing: "Reviewing",
  fixing: "Drafting fixes",
  done: "Done",
  error: "Error",
};

export const stagesFor = (modality: Modality): Stage[] =>
  modality === "video"
    ? ["extracting_media", "transcribing", "picking_frames", "extracting_claims", "reviewing", "fixing", "done"]
    : ["extracting_claims", "reviewing", "fixing", "done"];

export function humanize(s: string): string {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export const fmtRange = (r: [number, number]): string => `${fmtTime(r[0])}–${fmtTime(r[1])}`;

export const pct = (v: number | null | undefined, digits = 0): string =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

export const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export const sortFindings = (fs: Finding[]): Finding[] =>
  [...fs].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.timestamp_s?.[0] ?? 0) - (b.timestamp_s?.[0] ?? 0),
  );

// ---------------------------------------------------------------- golden comparison
// Mirrors backend/evals/scoring.py: same category and, when both carry a window, overlap within
// ±2 s. One-to-one greedy match, required findings first, then best overlap. A prediction
// compatible with no golden finding is a false flag; a surplus re-flag is a duplicate; omission
// findings on regulator text excerpts are neutral.

const OMISSION = new Set<Category>(["missing_risk_information", "inadequate_disclosure_prominence"]);
const TOL = 2;
const overlap = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

export const isRequired = (g: GoldenFinding, sourceType: string): boolean =>
  g.required ?? (REGULATOR_SOURCES.has(sourceType) || g.severity === "high");

export interface GoldenRow {
  golden: GoldenFinding;
  required: boolean;
  match: number | null; // index into report.findings
}

export type PredStatus = "matched" | "duplicate" | "false_flag" | "neutral";

export interface GoldenComparison {
  rows: GoldenRow[];
  predStatus: PredStatus[];
  mustCatchTotal: number;
  mustCatchHit: number;
  verdictOk: boolean;
}

export function verdictMatches(expected: Verdict, predicted: Verdict): boolean {
  if (expected === "needs_review") return predicted === "needs_review" || predicted === "non_compliant";
  return expected === predicted;
}

export function compareGolden(gc: GoldenCase, findings: Finding[], verdict: Verdict): GoldenComparison {
  const required = gc.expected_findings.map((g) => isRequired(g, gc.source_type));
  const pairs: { g: number; p: number; rank: number; ov: number }[] = [];
  const compatible = new Set<number>();
  gc.expected_findings.forEach((g, gi) => {
    findings.forEach((p, pi) => {
      if (p.category !== g.category) return;
      let ov = 0;
      if (g.timestamp_s && p.timestamp_s) {
        ov = overlap(g.timestamp_s, p.timestamp_s);
        if (ov < -TOL) return;
      }
      compatible.add(pi);
      pairs.push({ g: gi, p: pi, rank: required[gi] ? 0 : 1, ov });
    });
  });
  pairs.sort((a, b) => a.rank - b.rank || b.ov - a.ov || a.g - b.g || a.p - b.p);
  const gMatch = new Map<number, number>();
  const pUsed = new Set<number>();
  for (const c of pairs) {
    if (gMatch.has(c.g) || pUsed.has(c.p)) continue;
    gMatch.set(c.g, c.p);
    pUsed.add(c.p);
  }
  const neutral = (p: Finding) =>
    gc.modality === "text" && REGULATOR_SOURCES.has(gc.source_type) && OMISSION.has(p.category);
  const rows = gc.expected_findings.map((g, gi) => ({ golden: g, required: required[gi], match: gMatch.get(gi) ?? null }));
  return {
    rows,
    predStatus: findings.map((p, pi) =>
      pUsed.has(pi) ? "matched" : compatible.has(pi) ? "duplicate" : neutral(p) ? "neutral" : "false_flag",
    ),
    mustCatchTotal: rows.filter((r) => r.required).length,
    mustCatchHit: rows.filter((r) => r.required && r.match !== null).length,
    verdictOk: verdictMatches(gc.expected_verdict, verdict),
  };
}

export function shortCompany(company: string): string {
  const dba = /\bdba\s+(.+)$/i.exec(company);
  if (dba) return dba[1].trim();
  return company.replace(/,?\s+(Inc\.|LLC|Ltd\.?)(?=\s|$)/g, "").replace(/\s+dba\s+.*/i, "").trim();
}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Library order: the richest views first. Prev / next in the workspace follows it. */
export const MODALITY_ORDER: Modality[] = ["video", "image", "text"];
export const inLibraryOrder = <T extends { modality: Modality; id: string }>(cases: T[]): T[] =>
  MODALITY_ORDER.flatMap((m) => cases.filter((c) => c.modality === m));
