// Single API module. Talks to FastAPI through the Vite proxy (/api, /media).
// Fixtures are used ONLY when VITE_USE_FIXTURES=1, so the real app never shows fake data.

import type {
  CaseWithAsset,
  EvalProgress,
  EvalRun,
  EvalRunSummary,
  Health,
  Job,
  Report,
  ReviewRequest,
} from "./types";

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === "1";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Returns null on 404 instead of throwing. */
async function maybe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface Api {
  health(): Promise<Health>;
  listCases(): Promise<CaseWithAsset[]>;
  getCase(id: string): Promise<CaseWithAsset>;
  getReport(adId: string): Promise<Report | null>;
  createReview(req: ReviewRequest): Promise<Job>;
  getJob(jobId: string): Promise<Job>;
  startEvals(caseIds?: string[]): Promise<{ run_id: string }>;
  evalProgress(): Promise<EvalProgress>;
  latestEval(): Promise<EvalRun | null>;
  getEvalRun(runId: string): Promise<EvalRun | null>;
  listEvalRuns(): Promise<EvalRunSummary[]>;
}

const realApi: Api = {
  health: () => http("/api/health"),
  listCases: () => http("/api/cases"),
  getCase: (id) => http(`/api/cases/${encodeURIComponent(id)}`),
  getReport: (adId) => maybe(http<Report>(`/api/reports/${encodeURIComponent(adId)}`)),
  createReview: (req) => {
    if (req.kind === "case") return http("/api/reviews", json({ case_id: req.case_id }));
    if (req.kind === "text") return http("/api/reviews", json({ text: req.text }));
    const form = new FormData();
    form.append("file", req.file);
    if (req.text) form.append("text", req.text);
    return http("/api/reviews", { method: "POST", body: form });
  },
  getJob: (jobId) => http(`/api/reviews/${encodeURIComponent(jobId)}`),
  startEvals: (caseIds) => http("/api/evals", json(caseIds?.length ? { case_ids: caseIds } : {})),
  evalProgress: () => http("/api/evals/progress"),
  latestEval: () => maybe(http<EvalRun>("/api/evals/latest")),
  getEvalRun: (runId) => maybe(http<EvalRun>(`/api/evals/${encodeURIComponent(runId)}`)),
  listEvalRuns: () => http("/api/evals"),
};

let fixtureApi: Promise<Api> | null = null;
function loadFixtures(): Promise<Api> {
  fixtureApi ??= import("./fixtures").then((m) => m.fixtureApi);
  return fixtureApi;
}

// Every method resolves the fixture implementation lazily so fixtures are never bundled into
// the default code path's critical chunk.
export const api: Api = USE_FIXTURES
  ? (new Proxy({} as Api, {
      get:
        (_t, key: keyof Api) =>
        async (...args: unknown[]) => {
          const impl = await loadFixtures();
          return (impl[key] as (...a: unknown[]) => unknown)(...args);
        },
    }) as Api)
  : realApi;

export const mediaUrl = (repoPath: string | null | undefined): string | null =>
  repoPath ? `/media/${repoPath.replace(/^\/+/, "")}` : null;
