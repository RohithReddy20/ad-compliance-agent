import { useCallback, useEffect, useState } from "react";
import { USE_FIXTURES, api } from "./api";
import { EvalsPage } from "./pages/EvalsPage";
import { ReviewPage } from "./pages/ReviewPage";
import type { CaseWithAsset, Health } from "./types";

type Route = { page: "review"; caseId: string | null | undefined } | { page: "evals" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "evals") return { page: "evals" };
  if (parts[0] === "review" && parts[1] === "new") return { page: "review", caseId: null };
  if (parts[0] === "review" && parts[1]) return { page: "review", caseId: decodeURIComponent(parts[1]) };
  return { page: "review", caseId: undefined }; // pick a default once cases load
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [cases, setCases] = useState<CaseWithAsset[]>([]);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null | "down">(null);

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    api.listCases().then(setCases, (e: Error) => setCasesError(e.message));
    api.health().then(setHealth, () => setHealth("down"));
  }, []);

  const navigate = useCallback((hash: string) => {
    location.hash = hash;
  }, []);

  // default selection: the first video case (the richest view)
  useEffect(() => {
    if (route.page === "review" && route.caseId === undefined && cases.length) {
      const first = cases.find((c) => c.modality === "video") ?? cases[0];
      history.replaceState(null, "", `#/review/${first.id}`);
      setRoute({ page: "review", caseId: first.id });
    }
  }, [route, cases]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/review">
          <span className="brand-mark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F5F4EF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span className="brand-name">Ad Compliance Desk</span>
          <span className="brand-sub">FDA · FTC</span>
        </a>
        <nav className="nav">
          <a href="#/review" className={route.page === "review" ? "active" : ""}>
            Review
          </a>
          <a href="#/evals" className={route.page === "evals" ? "active" : ""}>
            Evals
          </a>
        </nav>
        <div className="topbar-right">
          {USE_FIXTURES && <span className="fixture-pill" title="VITE_USE_FIXTURES=1: data is canned, not from the API">Fixture data</span>}
          <span className={`status-dot ${health === "down" ? "down" : health ? "ok" : ""}`} />
          <span className="mono">
            {health === "down" ? "API unreachable" : health ? health.model : "connecting…"}
          </span>
        </div>
      </header>
      {route.page === "evals" ? (
        <EvalsPage cases={cases} navigate={navigate} />
      ) : (
        <ReviewPage
          cases={cases}
          casesError={casesError}
          selectedId={route.caseId}
          navigate={navigate}
        />
      )}
    </div>
  );
}
