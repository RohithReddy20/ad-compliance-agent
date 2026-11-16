// Fixture reports for VITE_USE_FIXTURES=1 only. Built on real golden cases, real captions
// and real frame files under data/videos/real/*/frames (extracted at 0.5 fps: f_N is t=(N-1)*2 s).

import type { Frame, Report, TranscriptSegment } from "../types";
import vid001Transcript from "./transcript-vid-001.json";

const f = (vid: string, t: number): string =>
  `data/videos/real/${vid}/frames/f_${String(Math.round(t / 2) + 1).padStart(3, "0")}.jpg`;

const vid001Frames: Frame[] = [
  { t: 0, path: f("vid-001", 0), reason: "Opening frame (safety net)" },
  { t: 12, path: f("vid-001", 12), reason: "Scene cut; 'Something's broken' VO" },
  { t: 24, path: f("vid-001", 24), reason: "Injection pens on production line under 'priced for profits' VO" },
  { t: 34, path: f("vid-001", 34), reason: "App screen showing Weight Loss product" },
  { t: 36, path: f("vid-001", 36), reason: "'life-changing weight loss medications' spoken" },
  { t: 40, path: f("vid-001", 40), reason: "'doctor-trusted' super; small fine print at bottom edge" },
  { t: 42, path: f("vid-001", 42), reason: "'formulated in the USA' spoken" },
  { t: 46, path: f("vid-001", 46), reason: "Treatment-plan claim; scene cut" },
  { t: 52, path: f("vid-001", 52), reason: "Long gap without a frame (safety net)" },
  { t: 56, path: f("vid-001", 56), reason: "End card begins (last 3 s)" },
  { t: 58, path: f("vid-001", 58), reason: "End card fine print (last 3 s)" },
];

const vid001: Report = {
  ad_id: "vid-001",
  modality: "video",
  verdict: "non_compliant",
  summary:
    "Promotes prescription weight-loss medication with strong benefit claims in audio but gives no risk information in any channel. The only compounded / not-FDA-approved disclosure appears as two lines of ~2% frame-height text for about 2 seconds while a large 'doctor-trusted' super competes for attention, and the drug-pricing framing implies the advertised product is equivalent to branded GLP-1s.",
  findings: [
    {
      category: "missing_risk_information",
      claim:
        "Hims & Hers offers life-changing weight loss medications. They're affordable, doctor trusted, and formulated in the USA.",
      rule: "21 U.S.C. 352(n); 21 CFR 202.1(e)(1) (broadcast major statement); FTC Act §§5, 12",
      severity: "high",
      rationale:
        "The ad promotes prescription weight-loss drugs but never states a side effect, contraindication or boxed warning in audio or on screen. A broadcast ad that makes benefit claims needs a major statement of the most important risks.",
      evidence_channel: "audio",
      timestamp_s: [35.25, 43.52],
      frame_path: f("vid-001", 36),
      suggested_fix:
        "Add a spoken major statement after the benefit claim, e.g. “Prescription only. Compounded GLP-1s can cause nausea, vomiting, pancreatitis and gallbladder problems; do not use with a personal or family history of medullary thyroid cancer.” Mirror it on screen.",
    },
    {
      category: "false_or_misleading_efficacy",
      claim: "Hims & Hers offers life-changing weight loss medications.",
      rule: "21 U.S.C. 352(a); 21 CFR 202.1(e)(6); FTC Act §§5, 12 (substantiation)",
      severity: "high",
      rationale:
        "“Life-changing” is an unqualified efficacy promise for compounded products that have no FDA-reviewed effectiveness data of their own.",
      evidence_channel: "audio",
      timestamp_s: [35.25, 38.89],
      frame_path: f("vid-001", 36),
      suggested_fix: "Hims & Hers connects you with licensed providers who can assess whether weight-loss medication is right for you.",
    },
    {
      category: "compounded_drug_misrepresentation",
      claim: "There are medications that work, but they're priced for profits, not patients.",
      rule: "21 U.S.C. 352(a); FD&C Act §503A; FTC Act §5",
      severity: "high",
      rationale:
        "Shown over branded injection pens on a production line, the line sets up the advertised compounded products as a cheaper version of the same FDA-approved drugs.",
      evidence_channel: "audio",
      timestamp_s: [23.05, 27.75],
      frame_path: f("vid-001", 24),
      suggested_fix:
        "Drop the implied substitution, or state plainly: “Our compounded medications are not FDA-approved and are not the same as Wegovy® or Zepbound®.”",
    },
    {
      category: "inadequate_disclosure_prominence",
      claim:
        "Prescription required. Compounded drug products are not FDA approved. The FDA does not evaluate compounded drug products for safety, effectiveness, or quality.",
      rule: "FTC Act §5 (clear and conspicuous; 16 CFR 255.0(f)); 21 CFR 202.1(e)(1)",
      severity: "high",
      rationale:
        "The disclosure is two lines of tiny white text over moving footage for about 2 seconds while a large 'doctor-trusted' super competes for attention. It is not clear and conspicuous, and it never appears in audio.",
      evidence_channel: "on_screen_text",
      timestamp_s: [39.4, 41.8],
      frame_path: f("vid-001", 40),
      suggested_fix:
        "Hold the disclosure for at least 5 seconds at legible size on a static background and read it in the voice-over: “Compounded drugs are not FDA-approved.”",
    },
    {
      category: "inadequate_disclosure_prominence",
      claim:
        "Not available in all 50 states. Weight Loss by Hims & Hers is a holistic program that includes … customized compounded medications or compounded GLP-1 injections … See website for details and important safety information.",
      rule: "FTC Act §5 (clear and conspicuous; 16 CFR 255.0(f)); 21 CFR 202.1(e)(1)",
      severity: "medium",
      rationale: "End-card fine print is small, low-contrast white on beige, and on screen for about 3 seconds.",
      evidence_channel: "on_screen_text",
      timestamp_s: [56.5, 60.0],
      frame_path: f("vid-001", 58),
      suggested_fix: "Raise contrast and size of the end-card text and extend it to the full end card.",
    },
    {
      category: "unsubstantiated_comparative_claim",
      claim: "A $160 billion industry that feeds on our failure.",
      rule: "FTC Act §5",
      severity: "low",
      rationale: "Characterises competitors without substantiation. Low priority; likely opinion.",
      evidence_channel: "audio",
      timestamp_s: [19.05, 23.05],
      frame_path: null,
      suggested_fix: null,
    },
  ],
  transcript: vid001Transcript as TranscriptSegment[],
  frames: vid001Frames,
  model: "gpt-6.1-terra",
  latency_s: 62.4,
  usage: { input_tokens: 48210, output_tokens: 3920 },
};

const fda001: Report = {
  ad_id: "fda-001",
  modality: "text",
  verdict: "non_compliant",
  summary:
    "All three passages tell readers that compounded semaglutide and tirzepatide contain 'the same active ingredient' as branded drugs, implying sameness with an FDA-approved product. None says the compounded products are not FDA-approved or gives risk information.",
  findings: [
    {
      category: "compounded_drug_misrepresentation",
      claim: "Compounded medications are created by licensed compounding pharmacies using the same active ingredients.",
      rule: "FDCA 502(a) and 502(bb) [21 U.S.C. 352(a), 352(bb)]; FDCA 301(a) [21 U.S.C. 331(a)]",
      severity: "high",
      rationale:
        "Positions compounded semaglutide as a cheaper equivalent of the branded product. Compounded drugs are not FDA-approved, so implying sameness misbrands them.",
      evidence_channel: "copy",
      timestamp_s: null,
      frame_path: null,
      suggested_fix:
        "Compounded semaglutide is prepared by a licensed compounding pharmacy for an individual patient. It is not FDA-approved and has not been reviewed by FDA for safety, effectiveness or quality.",
    },
    {
      category: "compounded_drug_misrepresentation",
      claim: "Compounded semaglutide contains the same active ingredient as branded semaglutide.",
      rule: "FDCA 502(a) and 502(bb) [21 U.S.C. 352(a), 352(bb)]; FDCA 301(a) [21 U.S.C. 331(a)]",
      severity: "high",
      rationale: "Direct sameness claim to an FDA-approved drug; the exact wording FDA cited.",
      evidence_channel: "copy",
      timestamp_s: null,
      frame_path: null,
      suggested_fix:
        "Compounded semaglutide is not the same as Ozempic® or Wegovy® and is not FDA-approved. Your provider will decide whether it is appropriate for you.",
    },
    {
      category: "compounded_drug_misrepresentation",
      claim:
        "Compounded formulations use the same active ingredient as the brand-name drug, customized by licensed compounding pharmacies to meet your needs.",
      rule: "FDCA 502(a) and 502(bb) [21 U.S.C. 352(a), 352(bb)]; FDCA 301(a) [21 U.S.C. 331(a)]",
      severity: "high",
      rationale: "Presents compounded tirzepatide as interchangeable with Mounjaro®.",
      evidence_channel: "copy",
      timestamp_s: null,
      frame_path: null,
      suggested_fix:
        "Compounded tirzepatide is not FDA-approved and is not a generic version of Mounjaro®. Ask your provider about FDA-approved options and risks.",
    },
    {
      category: "false_or_misleading_efficacy",
      claim: "an effective and budget-friendly alternative",
      rule: "FDCA 502(a); FTC Act §§5, 12 (substantiation)",
      severity: "medium",
      rationale:
        "Asserts effectiveness for a compounded product without product-specific evidence (FDA letter footnote 2: overstatement of efficacy).",
      evidence_channel: "copy",
      timestamp_s: null,
      frame_path: null,
      suggested_fix: "a lower-cost option your provider may consider",
    },
  ],
  transcript: [],
  frames: [],
  model: "gpt-6.1-terra",
  latency_s: 9.8,
  usage: { input_tokens: 6120, output_tokens: 1410 },
};

const img002: Report = {
  ad_id: "img-002",
  modality: "image",
  verdict: "non_compliant",
  summary:
    "Display ad sells $99 NAD+ injections as the same as $500 IV drips and promises anti-aging results from the first dose. The only qualifiers ('Results may vary. Prescription is required.') are fine print at the bottom edge, and nothing says the injection is compounded or not FDA-approved.",
  findings: [
    {
      category: "false_or_misleading_efficacy",
      claim: "NAD+, Look & Feel Younger—Starting With Your Very First Dose.",
      rule: "FTC Act §§5, 12 (15 U.S.C. 45, 52); FTC Health Products Compliance Guidance; 21 U.S.C. 352(a)",
      severity: "high",
      rationale: "Anti-aging outcome promised from a single dose with no competent and reliable scientific evidence.",
      evidence_channel: "on_screen_text",
      timestamp_s: null,
      frame_path: null,
      suggested_fix: "NAD+ injections, prescribed if appropriate after an online consultation.",
    },
    {
      category: "unsubstantiated_comparative_claim",
      claim: "IV drips are $500. This is $99. Same NAD+. No clinic visit.",
      rule: "FTC Act §5; 21 U.S.C. 352(a); 21 CFR 202.1(e)(6)(ii)",
      severity: "medium",
      rationale: "Equates a subcutaneous injection with IV infusion without evidence of comparable delivery or effect.",
      evidence_channel: "on_screen_text",
      timestamp_s: null,
      frame_path: null,
      suggested_fix: "NAD+ injections from $99/month. Prescription required.",
    },
    {
      category: "compounded_drug_misrepresentation",
      claim: "Same NAD+.",
      rule: "21 U.S.C. 352(a); FTC Act §5",
      severity: "medium",
      rationale: "Sameness claim for a compounded injectable without stating it is compounded and not FDA-approved.",
      evidence_channel: "on_screen_text",
      timestamp_s: null,
      frame_path: null,
      suggested_fix: "Compounded NAD+ injection. Not FDA-approved.",
    },
    {
      category: "inadequate_disclosure_prominence",
      claim: "Results may vary. Prescription is required.",
      rule: "FTC .com Disclosures (clear and conspicuous); FTC Endorsement Guides 16 CFR 255.2(b)",
      severity: "medium",
      rationale: "Qualifier is tiny, low-contrast and separated from the claims it qualifies.",
      evidence_channel: "visual",
      timestamp_s: null,
      frame_path: null,
      suggested_fix: "Place the qualifier directly beneath the headline at a readable size.",
    },
  ],
  transcript: [],
  frames: [],
  model: "gpt-6.1-terra",
  latency_s: 13.5,
  usage: { input_tokens: 5310, output_tokens: 1180 },
};

export const fixtureReports: Record<string, Report> = {
  "vid-001": vid001,
  "fda-001": fda001,
  "img-002": img002,
};
