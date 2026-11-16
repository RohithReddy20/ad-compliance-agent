import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { IconAlert, IconCheck, IconPlay, IconX, VerdictBadge } from "../components/ui";
import { MODALITY_LABEL, categoryLabel, pct } from "../lib";
import type { CaseWithAsset, EvalProgress, EvalRun, EvalRunSummary } from "../types";

interface Props {
  cases: CaseWithAsset[];
  navigate: (hash: string) => void;
}

export function EvalsPage({ cases, navigate }: Props) {
  const [run, setRun] = useState<EvalRun | null>(null);
  const [history, setHistory] = useState<EvalRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<EvalProgress | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const refresh = useCallback(async (runId?: string | null) => {
    try {
      const [r, h] = await Promise.all([runId ? api.getEvalRun(runId) : api.latestEval(), api.listEvalRuns()]);
      setRun(r);
      setHistory(h);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(selectedRun);
  }, [refresh, selectedRun]);

  // pick up a run already in progress (e.g. started from the CLI or another tab)
  useEffect(() => {
    api.evalProgress().then((p) => p.running && setProgress(p)).catch(() => undefined);
  }, []);

  const running = progress?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      try {
        const p = await api.evalProgress();
        setProgress(p);
        if (!p.running) {
          setSelectedRun(null);
          await refresh(null);
        }
      } catch (e) {
        setProgress(null);
        setError((e as Error).message);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, refresh]);

  const startRun = async () => {
    try {
      const r = await api.startEvals();
      setProgress({ running: true, done: 0, total: cases.length || 0, run_id: r.run_id, error: null });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const titles = useMemo(() => new Map(cases.map((c) => [c.id, c.title])), [cases]);
  const isLatest = !selectedRun || selectedRun === history[0]?.run_id;

  return (
    <div className="evals">
      <div className="evals-inner">
        <div className="evals-head">
          <div>
            <div className="section-label">Eval harness · golden set</div>
            <h1>Evaluation</h1>
            {run && (
              <div className="meta-row">
                <span className="mono">{run.run_id}</span>
                <span className="sep" />
                <span>{fmtDate(run.created_at)}</span>
                <span className="sep" />
                <span className="mono">{run.model}</span>
                <span className="sep" />
                <span className="tnum">{run.n_cases} cases</span>
                {run.baseline_run_id && (
                  <>
                    <span className="sep" />
                    <span>
                      vs baseline <span className="mono">{run.baseline_run_id}</span>
                    </span>
                  </>
                )}
                {!isLatest && (
                  <button className="btn ghost" style={{ height: 24 }} onClick={() => setSelectedRun(null)}>
                    Back to latest
                  </button>
                )}
              </div>
            )}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
            {running && progress && (
              <div className="progress">
                <span>
                  Running <span className="tnum">{progress.done}</span> / <span className="tnum">{progress.total}</span>{" "}
                  cases…
                </span>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 4}%` }}
                  />
                </div>
              </div>
            )}
            <button className="btn primary" onClick={startRun} disabled={running}>
              <IconPlay size={12} /> {running ? "Running…" : "Run evals"}
            </button>
          </div>
        </div>

        {progress?.error && <div className="error-box">Eval run failed: {progress.error}</div>}
        {error && <div className="error-box">{error}</div>}
        {loading && <div className="loading">Loading…</div>}
        {!loading && !run && !error && (
          <div className="card empty">
            <h3>No eval runs yet</h3>
            <p>Run the harness over the golden set to get recall, precision and verdict accuracy.</p>
          </div>
        )}

        {run && (
          <>
            {run.regressions.length > 0 && (
              <div className="regress fade-in">
                <IconAlert size={18} />
                <div>
                  <b>Regression vs baseline</b>
                  <ul>
                    {run.regressions.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <Kpis run={run} />

            <div className="evals-grid">
              <div className="card">
                <div className="card-head">
                  <h2>Recall by category</h2>
                  <span className="right">must-catch findings · n = support</span>
                </div>
                <CategoryBars run={run} />
              </div>
              <div className="card">
                <div className="card-head">
                  <h2>Run history</h2>
                  <span className="right">click a run to inspect it</span>
                </div>
                <History history={history} current={run.run_id} onPick={(id) => setSelectedRun(id)} />
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Per case</h2>
                <span className="right">click a row to open the review</span>
              </div>
              <CaseTable run={run} titles={titles} onOpen={(id) => navigate(`#/review/${id}`)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- KPIs

type Dir = "up" | "down";
interface KpiDef {
  key: string;
  label: string;
  value: (r: EvalRun) => string;
  unit?: string;
  sub: (r: EvalRun) => string;
  better: Dir;
  fmtDelta: (d: number) => string;
}

const pts = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d * 100).toFixed(1)} pts`;

const KPIS: KpiDef[] = [
  {
    key: "must_catch_recall",
    label: "Must-catch recall",
    value: (r) => pct(r.must_catch_recall),
    sub: (r) => {
      const hit = r.cases.reduce((a, c) => a + c.must_catch_hit, 0);
      const tot = r.cases.reduce((a, c) => a + c.must_catch_total, 0);
      return `${hit} of ${tot} regulator / high-severity findings`;
    },
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "precision",
    label: "Precision",
    value: (r) => pct(r.precision),
    sub: () => "flags that match a golden finding",
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "verdict_accuracy",
    label: "Verdict accuracy",
    value: (r) => pct(r.verdict_accuracy),
    sub: (r) => `${r.cases.filter((c) => c.verdict_ok).length} of ${r.cases.length} cases`,
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "false_flags_on_compliant",
    label: "False flags on controls",
    value: (r) => String(r.false_flags_on_compliant),
    sub: (r) => `${r.cases.filter((c) => c.expected_verdict === "compliant").length} compliant controls`,
    better: "down",
    fmtDelta: (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}`,
  },
  {
    key: "timestamp_hit_rate",
    label: "Timestamp hit rate",
    value: (r) => pct(r.timestamp_hit_rate),
    sub: (r) => {
      const hit = r.cases.reduce((a, c) => a + c.timestamp_hits, 0);
      const tot = r.cases.reduce((a, c) => a + c.timestamp_total, 0);
      return tot ? `${hit} of ${tot} video findings within ±2 s` : "no video findings scored";
    },
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "total_latency_s",
    label: "Latency · tokens",
    value: (r) => `${(r.total_latency_s / Math.max(1, r.n_cases)).toFixed(1)}`,
    unit: "s / case",
    sub: (r) => {
      const t = (r.usage.input_tokens ?? 0) + (r.usage.output_tokens ?? 0);
      return `${r.total_latency_s.toFixed(0)} s total · ${fmtTokens(t)} tokens`;
    },
    better: "down",
    fmtDelta: (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(1)} s total`,
  },
];

function Kpis({ run }: { run: EvalRun }) {
  const regressedText = run.regressions.join(" ").toLowerCase();
  return (
    <div className="kpis">
      {KPIS.map((k) => {
        const d = run.deltas[k.key];
        const hasDelta = d !== undefined && run.baseline_run_id;
        const good = hasDelta && (k.better === "up" ? d > 0 : d < 0);
        const bad = hasDelta && (k.better === "up" ? d < 0 : d > 0);
        const regressed =
          regressedText.includes(k.key) ||
          (k.key === "false_flags_on_compliant" && regressedText.includes("false flag")) ||
          (k.key === "must_catch_recall" && regressedText.includes("recall")) ||
          (k.key === "verdict_accuracy" && regressedText.includes("verdict"));
        return (
          <div key={k.key} className={`card kpi ${regressed ? "regressed" : ""}`}>
            <span className="label">{k.label}</span>
            <span className="value">
              {k.value(run)}
              {k.unit && <small>{k.unit}</small>}
            </span>
            {hasDelta ? (
              <span className={`delta ${good ? "good" : bad ? "bad" : "flat"}`}>
                {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {k.fmtDelta(d)}
              </span>
            ) : (
              <span className="delta flat">{run.baseline_run_id ? "no delta reported" : "no baseline"}</span>
            )}
            <span className="sub">{k.sub(run)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- category bars

function CategoryBars({ run }: { run: EvalRun }) {
  const rows = Object.entries(run.per_category).sort(
    (a, b) => (b[1].support > 0 ? 1 : 0) - (a[1].support > 0 ? 1 : 0) || a[1].recall - b[1].recall,
  );
  if (!rows.length) return <div className="notes">No category data in this run.</div>;
  return (
    <div className="bars">
      {rows.map(([cat, { recall, support }]) => {
        const none = support === 0;
        return (
          <div key={cat} className={`bar-row ${none ? "nosupport" : ""}`}>
            <span>{categoryLabel(cat)}</span>
            <div className="bar-track">
              {!none && (
                <div
                  className={`bar-fill ${recall < 0.5 ? "weak" : recall < 0.8 ? "mid" : ""}`}
                  style={{ width: `${Math.max(recall * 100, recall > 0 ? 2 : 0)}%` }}
                />
              )}
            </div>
            <span className="num">{none ? "—" : pct(recall)}</span>
            <span className="n">n={Math.round(support)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- history

function History({
  history,
  current,
  onPick,
}: {
  history: EvalRunSummary[];
  current: string;
  onPick: (id: string) => void;
}) {
  if (!history.length) return <div className="notes">No runs yet.</div>;
  const chrono = [...history].reverse();
  return (
    <>
      {history.length > 1 && <Spark runs={chrono} />}
      <table className="tbl">
        <thead>
          <tr>
            <th>Run</th>
            <th className="num">Recall</th>
            <th className="num">Precision</th>
            <th className="num">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr
              key={h.run_id}
              className="link"
              onClick={() => onPick(h.run_id)}
              style={h.run_id === current ? { background: "var(--accent-soft)" } : undefined}
            >
              <td>
                <div className="mono" style={{ fontWeight: h.run_id === current ? 600 : 400 }}>
                  {h.run_id}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {fmtDate(h.created_at)} · {h.model}
                </div>
              </td>
              <td className="num">{pct(h.must_catch_recall)}</td>
              <td className="num">{pct(h.precision)}</td>
              <td className="num">{pct(h.verdict_accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Spark({ runs }: { runs: EvalRunSummary[] }) {
  const W = 520;
  const H = 70;
  const pad = 10;
  const all = runs.flatMap((r) => [r.must_catch_recall, r.precision, r.verdict_accuracy]);
  const lo = Math.max(0, Math.floor((Math.min(...all) - 0.05) * 10) / 10);
  const x = (i: number) => pad + (i / Math.max(1, runs.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (1 - lo)) * (H - pad * 2);
  const line = (k: "must_catch_recall" | "precision" | "verdict_accuracy") =>
    runs.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
  const series = [
    { k: "must_catch_recall" as const, c: "var(--accent)", label: "Recall" },
    { k: "precision" as const, c: "#8a6d3b", label: "Precision" },
    { k: "verdict_accuracy" as const, c: "var(--ink-3)", label: "Verdict" },
  ];
  return (
    <div style={{ padding: "10px 16px 4px", borderBottom: "1px solid var(--line)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="spark" preserveAspectRatio="none">
        {[lo, (lo + 1) / 2, 1].map((g, k) => (
          <line key={k} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray={k === 1 ? "3 3" : undefined} />
        ))}
        {series.map((s) => (
          <path key={s.k} d={line(s.k)} fill="none" stroke={s.c} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--ink-3)", padding: "2px 0 6px" }}>
        {series.map((s) => (
          <span key={s.k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i style={{ width: 12, height: 2, background: s.c, display: "inline-block" }} />
            {s.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>
          {pct(lo)}–100% · oldest → latest
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- per-case table

function CaseTable({
  run,
  titles,
  onOpen,
}: {
  run: EvalRun;
  titles: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  const rows = [...run.cases].sort(
    (a, b) => badness(b) - badness(a) || a.case_id.localeCompare(b.case_id),
  );
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: "25%" }}>Case</th>
          <th>Expected → predicted</th>
          <th className="num">Must-catch</th>
          <th style={{ width: "22%" }}>Missed</th>
          <th style={{ width: "20%" }}>False flags</th>
          <th className="num">Timestamps</th>
          <th className="num">Latency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const bad = !c.verdict_ok || c.missed.length > 0 || c.false_flags.length > 0 || !!c.error;
          return (
            <tr key={c.case_id} className={`link ${bad ? "bad-row" : ""}`} onClick={() => onOpen(c.case_id)}>
              <td>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span className="mono">{c.case_id}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {MODALITY_LABEL[c.modality]}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.35, marginTop: 2 }}>
                  {titles.get(c.case_id) ?? ""}
                </div>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                  <VerdictBadge verdict={c.expected_verdict} />
                  <span className="muted">→</span>
                  {c.predicted_verdict ? <VerdictBadge verdict={c.predicted_verdict} /> : <span className="muted">—</span>}
                  {c.verdict_ok ? (
                    <IconCheck size={14} className="ok-mark" />
                  ) : (
                    <IconX size={14} className="x-mark" />
                  )}
                </div>
                {c.error && (
                  <div style={{ color: "var(--high)", fontSize: 12, marginTop: 4 }}>Error: {c.error}</div>
                )}
              </td>
              <td className="num">
                {c.must_catch_total ? (
                  <>
                    <span style={{ color: c.must_catch_hit < c.must_catch_total ? "var(--high)" : undefined }}>
                      {c.must_catch_hit}/{c.must_catch_total}
                    </span>
                    <span className="mini">
                      <i style={{ width: `${(c.must_catch_hit / c.must_catch_total) * 100}%` }} />
                    </span>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <IssueList items={c.missed} kind="miss" />
              </td>
              <td>
                <IssueList items={c.false_flags} kind="ff" />
              </td>
              <td className="num">
                {c.timestamp_total ? `${c.timestamp_hits}/${c.timestamp_total}` : <span className="muted">—</span>}
              </td>
              <td className="num">{c.latency_s.toFixed(1)}s</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function IssueList({ items, kind }: { items: string[]; kind: "miss" | "ff" }) {
  if (!items.length) return <span className="muted">—</span>;
  return (
    <ul className={`issue-list ${kind}`}>
      {items.map((s, i) => {
        const idx = s.indexOf(": ");
        const cat = idx > 0 ? s.slice(0, idx) : "";
        const claim = idx > 0 ? s.slice(idx + 2) : s;
        return (
          <li key={i} title={claim}>
            {cat && <span className="k">{categoryLabel(cat)}: </span>}
            <span>{claim.length > 90 ? `${claim.slice(0, 89)}…` : claim}</span>
          </li>
        );
      })}
    </ul>
  );
}

const badness = (c: EvalRun["cases"][number]) =>
  (c.error ? 8 : 0) + (c.verdict_ok ? 0 : 4) + c.missed.length * 2 + c.false_flags.length;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
