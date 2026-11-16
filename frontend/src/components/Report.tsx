import { useEffect, useMemo, useRef } from "react";
import { mediaUrl } from "../api";
import {
  CATEGORY_LABEL,
  CHANNEL_LABEL,
  STAGE_LABEL,
  VERDICT_LABEL,
  fmtRange,
  fmtTime,
  type GoldenComparison,
  type PredStatus,
} from "../lib";
import type { Finding, GoldenCase, Modality, Report, Stage, TranscriptSegment } from "../types";
import { Inspector } from "./Inspector";
import { IconAlert, IconArrow, IconCheck, IconChevron, IconDash, IconPlay, IconX, SeverityTag, VerdictBadge } from "./ui";

// ---------------------------------------------------------------- status strip: verdict

interface VerdictStripProps {
  report: Report;
  cmp: GoldenComparison | null;
  onShowGolden: () => void;
}

/** The answer, above everything else: verdict, why in one paragraph, and how it scored. */
export function VerdictStrip({ report, cmp, onShowGolden }: VerdictStripProps) {
  const counts = { high: 0, medium: 0, low: 0 };
  report.findings.forEach((f) => counts[f.severity]++);
  const tokens = (report.usage.input_tokens ?? 0) + (report.usage.output_tokens ?? 0);
  const extra = cmp ? cmp.predStatus.filter((s) => s === "false_flag").length : 0;
  const missed = cmp ? cmp.mustCatchTotal - cmp.mustCatchHit : 0;
  return (
    <section className={`strip verdict-strip v-${report.verdict}`} aria-label="Verdict">
      <Inspector mood={report.verdict} size={88} bust className="insp-rise" />
      <div className="strip-main">
        <div className="strip-kicker">Agent verdict</div>
        <h2 className="verdict-word">{VERDICT_LABEL[report.verdict]}</h2>
        <div className="sev-counts">
          {(["high", "medium", "low"] as const).map((s) =>
            counts[s] ? (
              <span key={s} className={`tag sev sev-${s}`}>
                <span className={`sev-dot sev-${s}`} />
                <span className="tnum">{counts[s]}</span> {s}
              </span>
            ) : null,
          )}
          {report.findings.length === 0 && <span className="muted">Nothing flagged</span>}
        </div>
      </div>
      <div className="strip-summary">
        <p>{report.summary}</p>
        <small>Findings are flagged for human review. They are not legal conclusions.</small>
      </div>
      <div className="strip-side">
        <dl className="facts">
          <div>
            <dt>Latency</dt>
            <dd>{report.latency_s.toFixed(1)} s</dd>
          </div>
          {tokens > 0 && (
            <div>
              <dt>Tokens</dt>
              <dd>{tokens.toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>Model</dt>
            <dd>{report.model}</dd>
          </div>
        </dl>
        {cmp && (
          <button className="golden-check" onClick={onShowGolden} title="Open the golden labels">
            <span className="gc-title">
              Against golden labels <IconChevron size={13} />
            </span>
            <span className="gc-items">
              <span className={`gc-item ${cmp.verdictOk ? "ok" : "bad"}`}>
                {cmp.verdictOk ? <IconCheck size={13} /> : <IconX size={13} />} Verdict
              </span>
              <span className={`gc-item ${cmp.mustCatchTotal === 0 ? "" : missed ? "bad" : "ok"}`}>
                <b className="tnum">
                  {cmp.mustCatchHit}/{cmp.mustCatchTotal}
                </b>{" "}
                must-catch
              </span>
              <span className={`gc-item ${extra ? "warn" : "ok"}`}>
                <b className="tnum">{extra}</b> extra
              </span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- status strip: running

interface RunStripProps {
  stages: Stage[];
  current: Stage; // last non-error stage seen
  error: string | null; // set when the job failed during `current`
  elapsed: number;
  jobId: string;
  onRetry: () => void;
}

export function RunStrip({ stages, current, error, elapsed, jobId, onRetry }: RunStripProps) {
  const failed = error !== null;
  const curIdx = current === "queued" ? (failed ? 0 : -1) : stages.indexOf(current);
  return (
    <section className="strip run-strip" aria-label="Review progress" aria-live="polite">
      <Inspector mood={failed ? "non_compliant" : "reading"} size={88} bust />
      <div className="strip-main">
        <div className="strip-kicker">{jobId ? `Job ${jobId}` : "Starting"}</div>
        <h2 className="strip-title">{failed ? "Review failed" : "Reviewing…"}</h2>
        {!failed && <div className="muted tnum">{elapsed.toFixed(0)} s elapsed</div>}
      </div>
      <div className="strip-wide">
        <ol className="stepper">
          {stages.map((s, i) => {
            const state =
              current === "done" || i < curIdx ? "done" : i === curIdx ? (failed ? "failed" : "current") : "";
            return (
              <li key={s} className={`step ${state}`} aria-current={state === "current" ? "step" : undefined}>
                <span className="step-dot">
                  {state === "done" ? <IconCheck size={11} /> : state === "failed" ? <IconX size={11} /> : null}
                </span>
                <span className="step-label">{STAGE_LABEL[s]}</span>
              </li>
            );
          })}
        </ol>
        {error && (
          <div className="error-box" role="alert">
            <span>{error}</span>
            <button className="btn small" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- status strip: nothing yet

export function EmptyStrip({ modality, loading, onRun }: { modality: Modality; loading: boolean; onRun: () => void }) {
  return (
    <section className="strip empty-strip" aria-label="Review status">
      <Inspector size={88} bust />
      <div className="strip-main">
        <h2 className="strip-title">{loading ? "Loading the last review…" : "Not reviewed yet"}</h2>
        {!loading && (
          <p className="muted">
            {modality === "video"
              ? "The agent transcribes the audio, picks the frames worth looking at, extracts every claim and checks each against FDA and FTC rules."
              : "The agent extracts every claim and checks each against FDA and FTC rules."}
          </p>
        )}
      </div>
      {!loading && (
        <button className="btn primary" onClick={onRun}>
          <IconPlay size={12} /> Run review
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- findings

interface FindingsProps {
  items: { f: Finding; i: number }[]; // display order, with the index into report.findings
  active: number | null;
  status?: PredStatus[];
  isVideo: boolean;
  onSelect: (i: number | null) => void;
  onSeek: (t: number) => void;
}

/** One row per finding; the selected one opens to show the evidence and the fix. */
export function FindingsList({ items, active, status, isVideo, onSelect, onSeek }: FindingsProps) {
  if (!items.length)
    return (
      <div className="panel-empty">
        <h3>No issues flagged</h3>
        <p>The reviewer found no claims that break the rules it checks.</p>
      </div>
    );
  return (
    <ol className="f-list">
      {items.map(({ f, i }, n) => (
        <FindingItem
          key={i}
          f={f}
          index={i}
          n={n + 1}
          open={active === i}
          status={status?.[i]}
          isVideo={isVideo}
          onSelect={onSelect}
          onSeek={onSeek}
        />
      ))}
    </ol>
  );
}

interface FindingItemProps {
  f: Finding;
  index: number;
  n: number;
  open: boolean;
  status?: PredStatus;
  isVideo: boolean;
  onSelect: (i: number | null) => void;
  onSeek: (t: number) => void;
}

function FindingItem({ f, index, n, open, status, isVideo, onSelect, onSeek }: FindingItemProps) {
  const ref = useRef<HTMLLIElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    wasOpen.current = open;
  }, [open]);
  const frame = isVideo ? mediaUrl(f.frame_path) : null;
  const label = CATEGORY_LABEL[f.category] ?? f.category;
  return (
    <li ref={ref} className={`f-item sev-${f.severity} ${open ? "open" : ""}`}>
      <button
        className="f-row"
        aria-expanded={open}
        aria-controls={`finding-${index}`}
        onClick={() => onSelect(open ? null : index)}
      >
        <span className="f-num tnum">{n}</span>
        <span className="f-text">
          <span className="f-cat">{label}</span>
          {!open && <span className="f-claim">{f.claim}</span>}
        </span>
        <span className="f-meta">
          {isVideo && f.timestamp_s && <span className="f-time tnum">{fmtRange(f.timestamp_s)}</span>}
          <SeverityTag severity={f.severity} />
        </span>
        <IconChevron size={16} className="f-chev" />
      </button>
      {open && (
        <div className="f-detail" id={`finding-${index}`}>
          {f.suggested_fix ? (
            <div className="fix">
              <div className="fix-box before">
                <span className="fix-label">As written</span>
                <p>{f.claim}</p>
              </div>
              <IconArrow size={16} className="fix-arrow" />
              <div className="fix-box after">
                <span className="fix-label">Suggested rewrite</span>
                <p>{stripReplace(f.suggested_fix)}</p>
              </div>
            </div>
          ) : (
            <blockquote className="claim">{f.claim}</blockquote>
          )}

          <div className={`f-grid ${frame ? "with-frame" : ""}`}>
            <dl className="f-why">
              <dt>Why it’s flagged</dt>
              <dd>{f.rationale}</dd>
              <dt>Rule</dt>
              <dd className="rule">{f.rule}</dd>
            </dl>
            {frame && (
              <button
                className="frame-thumb"
                onClick={() => f.timestamp_s && onSeek(f.timestamp_s[0])}
                title={isVideo ? "Jump the video to this frame" : "The frame the reviewer saw"}
              >
                <img src={frame} alt={`Frame examined for ${label}`} loading="lazy" />
                <span className="cap">{frameCaption(f)}</span>
              </button>
            )}
          </div>

          <div className="f-tags">
            <span className="tag">Evidence: {CHANNEL_LABEL[f.evidence_channel].toLowerCase()}</span>
            {status === "matched" && (
              <span className="tag ok">
                <IconCheck size={12} /> In the golden labels
              </span>
            )}
            {status === "false_flag" && <span className="tag sev sev-medium">Not in the golden labels</span>}
            {status === "duplicate" && <span className="tag">Duplicate of another finding</span>}
            {isVideo && f.timestamp_s && (
              <button className="ts-btn" onClick={() => onSeek(f.timestamp_s![0])}>
                <IconPlay size={10} /> Play from {fmtTime(f.timestamp_s[0])}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

const stripReplace = (s: string) => s.replace(/^Replace with:\s*/i, "").replace(/^[“"](.*)[”"]$/s, "$1");

function frameCaption(f: Finding): string {
  const m = /t(\d+(?:\.\d+)?)\.jpg$/.exec(f.frame_path ?? "");
  if (m) return `Frame at ${fmtTime(Number(m[1]))}`;
  return f.timestamp_s ? `Frame near ${fmtTime(f.timestamp_s[0])}` : "Frame examined";
}

// ---------------------------------------------------------------- golden labels

interface GoldenProps {
  gc: GoldenCase;
  report: Report;
  cmp: GoldenComparison;
  onJump: (findingIndex: number) => void;
}

export function GoldenTab({ gc, report, cmp, onJump }: GoldenProps) {
  const falseFlags = cmp.predStatus.map((s, i) => (s === "false_flag" ? i : -1)).filter((i) => i >= 0);
  const missed = cmp.rows.filter((r) => r.required && r.match === null).length;
  return (
    <div className="golden">
      <div className="golden-summary">
        <span className="stat-chip">
          Expected <VerdictBadge verdict={gc.expected_verdict} />
        </span>
        <span className={`stat-chip ${cmp.verdictOk ? "good" : "bad"}`}>
          {cmp.verdictOk ? <IconCheck size={12} /> : <IconX size={12} />}
          {cmp.verdictOk ? "Verdict matches" : `Agent said ${VERDICT_LABEL[report.verdict].toLowerCase()}`}
        </span>
        <span className={`stat-chip ${cmp.mustCatchTotal === 0 ? "" : missed ? "bad" : "good"}`}>
          <b className="tnum">
            {cmp.mustCatchHit}/{cmp.mustCatchTotal}
          </b>
          must-catch found
        </span>
        <span className={`stat-chip ${falseFlags.length ? "bad" : "good"}`}>
          <b className="tnum">{falseFlags.length}</b>
          {gc.expected_verdict === "compliant" ? "false flags on a compliant control" : "extra, not in the labels"}
        </span>
      </div>

      {cmp.rows.length === 0 && (
        <p className="notes">
          No violations are expected: this ad is a compliant control. Any finding here counts as a false flag.
        </p>
      )}

      {cmp.rows.length > 0 && <h3 className="panel-sub">What a regulator or labeller flagged</h3>}
      <ul className="g-list">
        {cmp.rows.map((r, i) => {
          const state = r.match !== null ? "matched" : r.required ? "missed" : "optional";
          const body = (
            <>
              <span className={`g-icon ${state}`}>
                {state === "matched" ? <IconCheck size={11} /> : state === "missed" ? <IconX size={11} /> : <IconDash size={11} />}
              </span>
              <span className="g-text">
                <span className="g-title">{CATEGORY_LABEL[r.golden.category]}</span>
                <span className="g-claim">{r.golden.claim}</span>
              </span>
              <span className={`g-status ${state}`}>
                {state === "matched" ? "Found" : state === "missed" ? "Missed" : "Not found"}
                <small>
                  {r.required ? "must-catch" : "optional"}
                  {r.golden.timestamp_s ? `, ${fmtRange(r.golden.timestamp_s)}` : ""}
                </small>
              </span>
            </>
          );
          return (
            <li key={i}>
              {r.match !== null ? (
                <button className="g-row" onClick={() => onJump(r.match!)} title="Show the matching finding">
                  {body}
                </button>
              ) : (
                <div className="g-row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      {falseFlags.length > 0 && (
        <>
          <h3 className="panel-sub">Flagged by the agent, not in the labels</h3>
          <ul className="g-list">
            {falseFlags.map((fi) => {
              const f = report.findings[fi];
              return (
                <li key={fi}>
                  <button className="g-row" onClick={() => onJump(fi)} title="Show this finding">
                    <span className="g-icon extra">
                      <IconAlert size={11} />
                    </span>
                    <span className="g-text">
                      <span className="g-title">{CATEGORY_LABEL[f.category]}</span>
                      <span className="g-claim">{f.claim}</span>
                    </span>
                    <span className="g-status extra">
                      {gc.expected_verdict === "compliant" ? "False flag" : "Extra"}
                      <small>{f.severity}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {gc.must_not_flag.length > 0 && (
        <>
          <h3 className="panel-sub">Must not be flagged</h3>
          <ul className="notes bullets">
            {gc.must_not_flag.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- transcript

interface TranscriptProps {
  segments: TranscriptSegment[];
  findings: Finding[];
  currentTime: number;
  follow: boolean;
  onSeek: (t: number) => void;
}

/** Whole-ad omissions (e.g. "no risk info anywhere") span everything; marking every line says nothing. */
export function flaggedSegments(segments: TranscriptSegment[], findings: Finding[]): (Finding | null)[] {
  const total = segments.length ? segments[segments.length - 1].end - segments[0].start : 0;
  const spot = findings.filter(
    (f) => f.timestamp_s && f.evidence_channel === "audio" && f.timestamp_s[1] - f.timestamp_s[0] <= total * 0.5,
  );
  return segments.map((s) => {
    let best: Finding | null = null;
    for (const f of spot) {
      if (!f.timestamp_s) continue;
      if (Math.min(s.end, f.timestamp_s[1]) - Math.max(s.start, f.timestamp_s[0]) <= 0.05) continue;
      if (!best || rank(f) < rank(best)) best = f;
    }
    return best;
  });
}

export function TranscriptTab({ segments, findings, currentTime, follow, onSeek }: TranscriptProps) {
  const box = useRef<HTMLOListElement>(null);
  const flagged = useMemo(() => flaggedSegments(segments, findings), [segments, findings]);
  const nowIdx = segments.findIndex((s) => currentTime >= s.start && currentTime < s.end);

  useEffect(() => {
    if (!follow || nowIdx < 0) return;
    box.current?.children[nowIdx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [nowIdx, follow]);

  return (
    <div className="transcript">
      <p className="panel-hint">
        <i className="thread-mark" /> marks lines spoken inside a flagged window. Select a line to jump the video there.
      </p>
      <ol ref={box}>
        {segments.map((s, i) => {
          const f = flagged[i];
          return (
            <li key={i}>
              <button
                className={`seg-line ${f ? `flagged sev-${f.severity}` : ""} ${i === nowIdx ? "now" : ""}`}
                onClick={() => onSeek(s.start)}
                title={f ? CATEGORY_LABEL[f.category] : undefined}
              >
                <span className="t tnum">{fmtTime(s.start)}</span>
                <span>{s.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const rank = (f: Finding) => ({ high: 0, medium: 1, low: 2 })[f.severity];
