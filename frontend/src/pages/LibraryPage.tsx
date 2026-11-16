import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { IconCheck, IconPlay, IconPlus, IconX, VerdictBadge } from "../components/ui";
import { MODALITY_LABEL, MODALITY_ORDER, SOURCE_LABEL, fmtTime, humanize, shortCompany, truncate } from "../lib";
import type { CaseScore, CaseWithAsset, Modality } from "../types";

interface Props {
  cases: CaseWithAsset[];
  casesError: string | null;
}

/** Landing page: every ad in the golden set, with what was expected and what the agent last said. */
export function LibraryPage({ cases, casesError }: Props) {
  const [filter, setFilter] = useState<Modality | "all">("all");
  const [q, setQ] = useState("");
  const [scores, setScores] = useState<Map<string, CaseScore>>(new Map());

  useEffect(() => {
    api
      .latestEval()
      .then((r) => r && setScores(new Map(r.cases.map((c) => [c.case_id, c]))))
      .catch(() => undefined);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: cases.length };
    for (const x of cases) c[x.modality] = (c[x.modality] ?? 0) + 1;
    return c;
  }, [cases]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visible = cases.filter(
      (c) =>
        (filter === "all" || c.modality === filter) &&
        (!needle || `${c.id} ${c.title} ${c.company} ${c.vertical}`.toLowerCase().includes(needle)),
    );
    return MODALITY_ORDER.map((m) => ({ modality: m, items: visible.filter((c) => c.modality === m) })).filter(
      (g) => g.items.length,
    );
  }, [cases, filter, q]);

  const shown = groups.reduce((a, g) => a + g.items.length, 0);

  return (
    <main className="page" id="main">
      <header className="page-head">
        <div>
          <h1>Ad library</h1>
          <p className="lede">
            Real telehealth ads and regulator letters with known outcomes. Open one to see what the agent flags and
            why, or review an ad of your own.
          </p>
        </div>
        <a className="btn primary" href="#/review/new">
          <IconPlus size={14} /> Review a new ad
        </a>
      </header>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by format">
          {(["all", ...MODALITY_ORDER] as const).map((m) => (
            <button key={m} className={filter === m ? "on" : ""} aria-pressed={filter === m} onClick={() => setFilter(m)}>
              {m === "all" ? "All" : MODALITY_LABEL[m]}
              <span className="count">{counts[m] ?? 0}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search by company, title or id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search ads"
        />
        <span className="muted toolbar-count" aria-live="polite">
          {shown} of {cases.length} shown
        </span>
      </div>

      {casesError && <div className="error-box">Could not load the ads: {casesError}</div>}
      {!casesError && !cases.length && <div className="loading">Loading ads…</div>}
      {cases.length > 0 && shown === 0 && (
        <div className="panel-empty">
          <h3>No ads match</h3>
          <p>Try a different search, or clear the format filter.</p>
          <button
            className="btn"
            onClick={() => {
              setQ("");
              setFilter("all");
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.modality} className="gallery-group" aria-label={`${MODALITY_LABEL[g.modality]} ads`}>
          <h2>
            {MODALITY_LABEL[g.modality]} ads <span className="muted">{g.items.length}</span>
          </h2>
          <div className="gallery">
            {g.items.map((c) => (
              <CaseCard key={c.id} c={c} score={scores.get(c.id)} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function CaseCard({ c, score }: { c: CaseWithAsset; score?: CaseScore }) {
  return (
    <a className="case-card" href={`#/review/${encodeURIComponent(c.id)}`}>
      <div className={`thumb thumb-${c.modality}`}>
        {c.modality === "video" && c.asset_url ? (
          <>
            <video src={`${c.asset_url}#t=1.5`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" />
            <span className="thumb-badge">
              <IconPlay size={10} />
              {c.duration_s != null ? fmtTime(c.duration_s) : "Video"}
            </span>
          </>
        ) : c.modality === "image" && c.asset_url ? (
          <img src={c.asset_url} alt="" loading="lazy" />
        ) : (
          <p>{truncate(c.ad_content.replace(/\s+/g, " "), 190)}</p>
        )}
      </div>
      <div className="cc-body">
        <div className="cc-kicker">
          <span>{SOURCE_LABEL[c.source_type] ?? humanize(c.source_type)}</span>
          <span className="tnum">{c.id}</span>
        </div>
        <h3>{c.title}</h3>
        <p className="cc-meta">
          {shortCompany(c.company)}, {humanize(c.vertical).toLowerCase()}
        </p>
      </div>
      <dl className="cc-verdicts">
        <div>
          <dt>Expected</dt>
          <dd>
            <VerdictBadge verdict={c.expected_verdict} />
          </dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>
            {score?.predicted_verdict ? (
              <>
                <VerdictBadge verdict={score.predicted_verdict} />
                <span className={`mark ${score.verdict_ok ? "ok" : "bad"}`} title={score.verdict_ok ? "Verdict matches" : "Verdict differs"}>
                  {score.verdict_ok ? <IconCheck size={13} /> : <IconX size={13} />}
                </span>
              </>
            ) : (
              <span className="muted">Not run yet</span>
            )}
          </dd>
        </div>
      </dl>
    </a>
  );
}
