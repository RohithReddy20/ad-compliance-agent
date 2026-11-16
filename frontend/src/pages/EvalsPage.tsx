import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Inspector } from "../components/Inspector";
import { IconArrow, IconCheck, IconChevron, IconPlay, IconX, VerdictBadge } from "../components/ui";
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
  const nReg = run?.regressions.length ?? 0;

  const headline = running
    ? "Running the golden set…"
    : !run
      ? "Evaluation"
      : nReg
        ? `${nReg} regression${nReg > 1 ? "s" : ""} against the baseline`
        : run.baseline_run_id
          ? "No regressions against the baseline"
          : "First run, nothing to compare against yet";

  return (
    <main className="page" id="main">
      <header className={`page-head gate-head ${run && !running ? (nReg ? "bad" : "good") : ""}`}>
        <Inspector size={84} bust mood={running ? "reading" : !run ? "idle" : nReg ? "non_compliant" : "compliant"} />
        <div>
          <h1>{headline}</h1>
          {run ? (
            <div className="meta-row">
              <span className="kind">
                Run <b className="tnum">{run.run_id}</b>
              </span>
              <span>{fmtDate(run.created_at)}</span>
              <span>{run.model}</span>
              <span className="tnum">{run.n_cases} cases</span>
              {run.baseline_run_id && (
                <span>
                  Baseline <span className="tnum">{run.baseline_run_id}</span>
                </span>
              )}
              {!isLatest && (
                <button className="btn small" onClick={() => setSelectedRun(null)}>
                  Back to the latest run
                </button>
              )}
            </div>
          ) : (
            <p className="lede">Scores the agent on every ad in the golden set, then compares with the last run.</p>
          )}
        </div>
        <div className="page-actions">
          {running && progress && (
            <div className="progress" role="status">
              <span>
                <span className="tnum">{progress.done}</span> of <span className="tnum">{progress.total}</span> cases done
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
      </header>

      {progress?.error && (
        <div className="error-box" role="alert">
          The eval run failed: {progress.error}
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {loading && <div className="loading">Loading…</div>}
      {!loading && !run && !error && (
        <div className="panel-empty">
          <h3>No eval runs yet</h3>
          <p>Run the evals to get must-catch recall, verdict accuracy and false flags across the golden set.</p>
        </div>
      )}

      {run && (
        <>
          {nReg > 0 && (
            <div className="regress" role="alert">
              <b>What got worse</b>
              <ul>
                {run.regressions.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <Scoreboard run={run} />

          <div className="evals-grid">
            <CaseResults run={run} titles={titles} onOpen={(id) => navigate(`#/review/${id}`)} />
            <div className="evals-side">
              <section className="card">
                <div className="card-head">
                  <h2>Recall by category</h2>
                  <span className="right">share of must-catch findings found</span>
                </div>
                <CategoryBars run={run} />
              </section>
              <section className="card">
                <div className="card-head">
                  <h2>Run history</h2>
                  <span className="right">select a run to inspect it</span>
                </div>
                <History history={history} current={run.run_id} onPick={(id) => setSelectedRun(id)} />
              </section>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- scoreboard

type Dir = "up" | "down";
interface Metric {
  key: string;
  label: string;
  value: (r: EvalRun) => string;
  unit?: string;
  sub: (r: EvalRun) => string;
  ratio?: (r: EvalRun) => number | null; // drawn as a meter when present
  better: Dir;
  fmtDelta: (d: number) => string;
}

const sign = (d: number) => (d > 0 ? "+" : d < 0 ? "−" : "±");
const pts = (d: number) => `${sign(d)}${Math.abs(d * 100).toFixed(1)} pts`;
const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** The three numbers the regression gate checks. */
const GATE: Metric[] = [
  {
    key: "must_catch_recall",
    label: "Must-catch recall",
    value: (r) => pct(r.must_catch_recall),
    ratio: (r) => r.must_catch_recall,
    sub: (r) => {
      const hit = r.cases.reduce((a, c) => a + c.must_catch_hit, 0);
      const tot = r.cases.reduce((a, c) => a + c.must_catch_total, 0);
      return `${hit} of ${tot} regulator or high-severity findings found`;
    },
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "verdict_accuracy",
    label: "Verdict accuracy",
    value: (r) => pct(r.verdict_accuracy),
    ratio: (r) => r.verdict_accuracy,
    sub: (r) => `${r.cases.filter((c) => c.verdict_ok).length} of ${r.cases.length} ads got the right verdict`,
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "false_flags_on_compliant",
    label: "False flags on clean ads",
    value: (r) => String(r.false_flags_on_compliant),
    sub: (r) => `across ${r.cases.filter((c) => c.expected_verdict === "compliant").length} compliant controls`,
    better: "down",
    fmtDelta: (d) => `${sign(d)}${Math.abs(d)}`,
  },
];

const SUPPORTING: Metric[] = [
  {
    key: "precision",
    label: "Precision",
    value: (r) => pct(r.precision),
    sub: () => "of flags match a golden finding",
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "timestamp_hit_rate",
    label: "Timestamps",
    value: (r) => pct(r.timestamp_hit_rate),
    sub: (r) => {
      const hit = r.cases.reduce((a, c) => a + c.timestamp_hits, 0);
      const tot = r.cases.reduce((a, c) => a + c.timestamp_total, 0);
      return tot ? `${hit} of ${tot} video findings within 2 s` : "no video findings scored";
    },
    better: "up",
    fmtDelta: pts,
  },
  {
    key: "total_latency_s",
    label: "Latency",
    value: (r) => (r.total_latency_s / Math.max(1, r.n_cases)).toFixed(1),
    unit: "s per ad",
    sub: (r) => `${r.total_latency_s.toFixed(0)} s in total`,
    better: "down",
    fmtDelta: (d) => `${sign(d)}${Math.abs(d).toFixed(1)} s total`,
  },
];

function Delta({ run, m }: { run: EvalRun; m: Metric }) {
  const d = run.deltas[m.key];
  if (d === undefined || !run.baseline_run_id) return <span className="delta flat">No baseline to compare</span>;
  const good = m.better === "up" ? d > 0 : d < 0;
  const bad = m.better === "up" ? d < 0 : d > 0;
  return (
    <span className={`delta ${good ? "good" : bad ? "bad" : "flat"}`}>
      {d > 0 ? "▲" : d < 0 ? "▼" : ""} {m.fmtDelta(d)} <span className="delta-vs">vs baseline</span>
    </span>
  );
}

function Scoreboard({ run }: { run: EvalRun }) {
  const regressedText = run.regressions.join(" ").toLowerCase();
  const regressed = (key: string) =>
    regressedText.includes(key) ||
    (key === "false_flags_on_compliant" && regressedText.includes("false flag")) ||
    (key === "must_catch_recall" && regressedText.includes("recall")) ||
    (key === "verdict_accuracy" && regressedText.includes("verdict"));
  const tokens = (run.usage.input_tokens ?? 0) + (run.usage.output_tokens ?? 0);
  return (
    <section className="scoreboard" aria-label="Scores">
      <div className="gate-metrics">
        {GATE.map((m) => {
          const ratio = m.ratio?.(run);
          return (
            <div key={m.key} className={`card metric ${regressed(m.key) ? "regressed" : ""}`}>
              <span className="label">{m.label}</span>
              <span className="value tnum">{m.value(run)}</span>
              {ratio != null && (
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${ratio * 100}%` }} />
                </span>
              )}
              <Delta run={run} m={m} />
              <span className="sub">{m.sub(run)}</span>
            </div>
          );
        })}
      </div>
      <dl className="card supporting">
        {SUPPORTING.map((m) => (
          <div key={m.key}>
            <dt>{m.label}</dt>
            <dd>
              <b className="tnum">{m.value(run)}</b>
              {m.unit && <span className="unit"> {m.unit}</span>}
              <span className="sub">{m.sub(run)}</span>
            </dd>
          </div>
        ))}
        <div>
          <dt>Tokens</dt>
          <dd>
            <b className="tnum">{fmtTokens(tokens)}</b>
            <span className="sub">
              {run.usage.cache_hits ? `${run.usage.cache_hits} calls served from cache` : "input and output combined"}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------- results by case

type Filter = "all" | "attention" | "clean";

const needsAttention = (c: EvalRun["cases"][number]) =>
  !c.verdict_ok || c.missed.length > 0 || c.false_flags.length > 0 || !!c.error;
const badness = (c: EvalRun["cases"][number]) =>
  (c.error ? 8 : 0) + (c.verdict_ok ? 0 : 4) + c.missed.length * 2 + c.false_flags.length;

function CaseResults({
  run,
  titles,
  onOpen,
}: {
  run: EvalRun;
  titles: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const nAttention = run.cases.filter(needsAttention).length;
  const counts: Record<Filter, number> = {
    all: run.cases.length,
    attention: nAttention,
    clean: run.cases.length - nAttention,
  };
  const rows = run.cases
    .filter((c) => filter === "all" || (filter === "attention") === needsAttention(c))
    .sort((a, b) => badness(b) - badness(a) || a.case_id.localeCompare(b.case_id));

  return (
    <section className="card cases-card">
      <div className="card-head">
        <h2>Results by ad</h2>
        <div className="seg" role="group" aria-label="Filter results">
          {(
            [
              ["all", "All"],
              ["attention", "Needs attention"],
              ["clean", "Fully correct"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
              <span className="count">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl cases-tbl">
          <colgroup>
            <col />
            <col style={{ width: 146 }} />
            <col style={{ width: 176 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 62 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Ad</th>
              <th>Expected</th>
              <th>Agent said</th>
              <th className="num">Must-catch</th>
              <th className="num">Missed</th>
              <th className="num">False flags</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isOpen = open === c.case_id;
              return (
                <Fragment key={c.case_id}>
                  <tr className={`${needsAttention(c) ? "bad-row" : ""} ${isOpen ? "open" : ""}`}>
                    <td>
                      <div className="row-id">
                        <b className="tnum">{c.case_id}</b>
                        <span className="muted small">{MODALITY_LABEL[c.modality]}</span>
                      </div>
                      <div className="row-title">{titles.get(c.case_id) ?? ""}</div>
                      {c.error && <div className="row-error">Error: {c.error}</div>}
                    </td>
                    <td>
                      <VerdictBadge verdict={c.expected_verdict} />
                    </td>
                    <td>
                      <span className="said">
                        {c.predicted_verdict ? <VerdictBadge verdict={c.predicted_verdict} /> : <span className="muted">No verdict</span>}
                        <span className={`mark ${c.verdict_ok ? "ok" : "bad"}`} title={c.verdict_ok ? "Matches" : "Does not match"}>
                          {c.verdict_ok ? <IconCheck size={13} /> : <IconX size={13} />}
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      {c.must_catch_total ? (
                        <span className={c.must_catch_hit < c.must_catch_total ? "short" : ""}>
                          {c.must_catch_hit}/{c.must_catch_total}
                        </span>
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </td>
                    <td className={`num ${c.missed.length ? "short" : "muted"}`}>{c.missed.length}</td>
                    <td className={`num ${c.false_flags.length ? "warn" : "muted"}`}>{c.false_flags.length}</td>
                    <td className="num">
                      <button
                        className="icon-btn"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} details for ${c.case_id}`}
                        onClick={() => setOpen(isOpen ? null : c.case_id)}
                      >
                        <IconChevron size={16} className={isOpen ? "down" : ""} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row">
                      <td colSpan={7}>
                        <div className="detail">
                          <IssueList title="Missed" items={c.missed} kind="miss" empty="Nothing missed." />
                          <IssueList title="False flags" items={c.false_flags} kind="ff" empty="No false flags." />
                          <div className="detail-foot">
                            <span className="muted tnum">
                              {c.timestamp_total ? `${c.timestamp_hits}/${c.timestamp_total} timestamps within 2 s, ` : ""}
                              {c.latency_s.toFixed(1)} s
                            </span>
                            <button className="btn small" onClick={() => onOpen(c.case_id)}>
                              Open the review <IconArrow size={13} />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="muted">
                  No ads in this group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IssueList({ title, items, kind, empty }: { title: string; items: string[]; kind: "miss" | "ff"; empty: string }) {
  return (
    <div className={`issues ${kind}`}>
      <h4>
        {title} <span className="tnum">{items.length}</span>
      </h4>
      {items.length ? (
        <ul>
          {items.map((s, i) => {
            const idx = s.indexOf(": ");
            const cat = idx > 0 ? s.slice(0, idx) : "";
            const claim = idx > 0 ? s.slice(idx + 2) : s;
            return (
              <li key={i}>
                {cat && <b>{categoryLabel(cat)}</b>}
                <span>{claim}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- category bars

function CategoryBars({ run }: { run: EvalRun }) {
  const rows = Object.entries(run.per_category).sort(
    (a, b) => (b[1].support > 0 ? 1 : 0) - (a[1].support > 0 ? 1 : 0) || a[1].recall - b[1].recall,
  );
  if (!rows.length) return <p className="notes">No category data in this run.</p>;
  return (
    <div className="bars">
      {rows.map(([cat, { recall, support }]) => {
        const none = support === 0;
        return (
          <div key={cat} className={`bar-row ${none ? "nosupport" : ""}`}>
            <span className="bar-label">{categoryLabel(cat)}</span>
            <span className="num tnum">{none ? "n/a" : pct(recall)}</span>
            <div className="bar-track">
              {!none && (
                <div
                  className={`bar-fill ${recall < 0.5 ? "weak" : recall < 0.8 ? "mid" : ""}`}
                  style={{ width: `${Math.max(recall * 100, recall > 0 ? 2 : 0)}%` }}
                />
              )}
            </div>
            <span className="n tnum">
              {Math.round(support)} {Math.round(support) === 1 ? "finding" : "findings"}
            </span>
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
  if (!history.length) return <p className="notes">No runs yet.</p>;
  const chrono = [...history].reverse();
  return (
    <>
      {history.length > 1 && <Spark runs={chrono} />}
      <div className="table-wrap history">
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
              <tr key={h.run_id} className={h.run_id === current ? "current" : ""}>
                <td>
                  <button className="run-pick" onClick={() => onPick(h.run_id)} aria-current={h.run_id === current}>
                    <span className="run-id tnum">{h.run_id}</span>
                    <span className="muted small">{fmtDate(h.created_at)}</span>
                  </button>
                </td>
                <td className="num">{pct(h.must_catch_recall)}</td>
                <td className="num">{pct(h.precision)}</td>
                <td className="num">{pct(h.verdict_accuracy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Spark({ runs }: { runs: EvalRunSummary[] }) {
  const W = 520;
  const H = 76;
  const pad = 10;
  const all = runs.flatMap((r) => [r.must_catch_recall, r.precision, r.verdict_accuracy]);
  const lo = Math.max(0, Math.floor((Math.min(...all) - 0.05) * 10) / 10);
  const x = (i: number) => pad + (i / Math.max(1, runs.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (1 - lo)) * (H - pad * 2);
  const line = (k: "must_catch_recall" | "precision" | "verdict_accuracy") =>
    runs.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
  const series = [
    { k: "must_catch_recall" as const, c: "var(--red)", label: "Recall", dash: undefined },
    { k: "precision" as const, c: "var(--amber-deep)", label: "Precision", dash: "6 4" },
    { k: "verdict_accuracy" as const, c: "var(--soot)", label: "Verdict", dash: "2 4" },
  ];
  return (
    <figure className="spark-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="spark" preserveAspectRatio="none" role="img" aria-label="Recall, precision and verdict accuracy across runs">
        {[lo, (lo + 1) / 2, 1].map((g, k) => (
          <line key={k} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => (
          <path
            key={s.k}
            d={line(s.k)}
            fill="none"
            stroke={s.c}
            strokeWidth={2.2}
            strokeDasharray={s.dash}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <figcaption className="spark-legend">
        {series.map((s) => (
          <span key={s.k}>
            <svg width="22" height="6" aria-hidden="true">
              <line x1="1" x2="21" y1="3" y2="3" stroke={s.c} strokeWidth="2.2" strokeDasharray={s.dash} strokeLinecap="round" />
            </svg>
            {s.label}
          </span>
        ))}
        <span className="spark-range">
          {pct(lo)} to 100%, oldest to latest
        </span>
      </figcaption>
    </figure>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
