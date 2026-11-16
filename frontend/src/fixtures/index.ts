// In-browser stand-in for the FastAPI backend. Loaded only when VITE_USE_FIXTURES=1.

import type { Api } from "../api";
import { ApiError } from "../api";
import type { CaseWithAsset, Job, Modality, Stage } from "../types";
import casesJson from "./cases.json";
import { fixtureLatestRun, fixtureRunHistory } from "./evals";
import { fixtureReports } from "./reports";

const cases = casesJson as CaseWithAsset[];

const VIDEO_STAGES: Stage[] = [
  "queued",
  "extracting_media",
  "transcribing",
  "picking_frames",
  "extracting_claims",
  "reviewing",
  "fixing",
  "done",
];
const STATIC_STAGES: Stage[] = ["queued", "extracting_claims", "reviewing", "fixing", "done"];
const STAGE_MS = 1100;

interface FakeJob {
  ad_id: string;
  modality: Modality;
  started: number;
}
const jobs = new Map<string, FakeJob>();
let evalStarted: number | null = null;

const delay = <T>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export const fixtureApi: Api = {
  health: () => delay({ ok: true, model: "gpt-6.1-terra (fixtures)" }),
  listCases: () => delay(cases),
  getCase: async (id) => {
    const found = cases.find((x) => x.id === id);
    if (!found) throw new ApiError(404, "case not found");
    return delay(found);
  },
  getReport: (adId) => delay(fixtureReports[adId] ?? null, 200),
  createReview: async (req) => {
    const job_id = Math.random().toString(36).slice(2, 10);
    let ad_id: string;
    let modality: Modality;
    if (req.kind === "case") {
      ad_id = req.case_id;
      modality = cases.find((x) => x.id === req.case_id)?.modality ?? "text";
    } else if (req.kind === "text") {
      ad_id = `upload-${job_id}`;
      modality = "text";
    } else {
      ad_id = `upload-${job_id}`;
      modality = req.file.type.startsWith("video") ? "video" : "image";
    }
    jobs.set(job_id, { ad_id, modality, started: Date.now() });
    return delay<Job>({ job_id, ad_id, stage: "queued", error: null, report: null });
  },
  getJob: async (jobId) => {
    const j = jobs.get(jobId);
    if (!j) throw new ApiError(404, "job not found");
    const stages = j.modality === "video" ? VIDEO_STAGES : STATIC_STAGES;
    const idx = Math.min(stages.length - 1, Math.floor((Date.now() - j.started) / STAGE_MS));
    const stage = stages[idx];
    if (stage !== "done") return delay<Job>({ job_id: jobId, ad_id: j.ad_id, stage, error: null, report: null });
    const report = fixtureReports[j.ad_id];
    if (!report)
      return delay<Job>({
        job_id: jobId,
        ad_id: j.ad_id,
        stage: "error",
        error: "Fixture mode has no canned report for this ad. Start the backend to review it for real.",
        report: null,
      });
    return delay<Job>({ job_id: jobId, ad_id: j.ad_id, stage: "done", error: null, report });
  },
  startEvals: async () => {
    evalStarted = Date.now();
    return delay({ run_id: fixtureLatestRun.run_id });
  },
  evalProgress: async () => {
    const total = fixtureLatestRun.n_cases;
    if (evalStarted === null) return delay({ running: false, done: 0, total, run_id: null, error: null });
    const done = Math.min(total, Math.floor((Date.now() - evalStarted) / 450));
    if (done >= total) evalStarted = null;
    return delay({ running: done < total, done, total, run_id: fixtureLatestRun.run_id, error: null });
  },
  latestEval: () => delay(fixtureLatestRun),
  getEvalRun: (runId) => delay(runId === fixtureLatestRun.run_id ? fixtureLatestRun : null),
  listEvalRuns: () => delay(fixtureRunHistory),
};
