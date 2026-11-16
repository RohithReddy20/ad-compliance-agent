import { useCallback, useEffect, useState } from "react";
import { USE_FIXTURES, api } from "./api";
import { Inspector } from "./components/Inspector";
import { IconPlus } from "./components/ui";
import { EvalsPage } from "./pages/EvalsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ReviewPage } from "./pages/ReviewPage";
import type { CaseWithAsset, Health } from "./types";

type Route = { page: "library" } | { page: "review"; caseId: string | null } | { page: "evals" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "evals") return { page: "evals" };
  if (parts[0] === "review" && parts[1] === "new") return { page: "review", caseId: null };
  if (parts[0] === "review" && parts[1]) return { page: "review", caseId: decodeURIComponent(parts[1]) };
  return { page: "library" };
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

  const onAds = route.page !== "evals";

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href="#/" aria-label="Ad Compliance Desk, home">
          <span className="brand-mark">
            <Inspector size={36} />
          </span>
          <span className="brand-name">Ad Compliance Desk</span>
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#/" aria-current={onAds ? "page" : undefined}>
            Ads
          </a>
          <a href="#/evals" aria-current={onAds ? undefined : "page"}>
            Evals
          </a>
        </nav>
        <div className="topbar-right">
          {USE_FIXTURES && (
            <span className="fixture-pill" title="VITE_USE_FIXTURES=1: data is canned, not from the API">
              Fixture data
            </span>
          )}
          <span className="api-status" title={health === "down" ? "The API is not reachable" : "Model reviewing the ads"}>
            <span className={`status-dot ${health === "down" ? "down" : health ? "ok" : ""}`} />
            {health === "down" ? "API unreachable" : health ? health.model : "Connecting…"}
          </span>
          {route.page === "evals" || (route.page === "review" && route.caseId !== null) ? (
            <a className="btn" href="#/review/new">
              <IconPlus size={14} /> New ad
            </a>
          ) : null}
        </div>
      </header>
      {route.page === "evals" ? (
        <EvalsPage cases={cases} navigate={navigate} />
      ) : route.page === "library" ? (
        <LibraryPage cases={cases} casesError={casesError} />
      ) : (
        <ReviewPage cases={cases} casesError={casesError} selectedId={route.caseId} navigate={navigate} />
      )}
    </div>
  );
}
