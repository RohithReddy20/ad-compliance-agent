import { useEffect, useMemo, useRef } from "react";
import { mediaUrl } from "../api";
import {
  CATEGORY_LABEL,
  STAGE_LABEL,
  VERDICT_LABEL,
  fmtRange,
  fmtTime,
  type GoldenComparison,
} from "../lib";
import type { Finding, GoldenCase, Report, Stage, TranscriptSegment } from "../types";
import {
  ChannelTag,
  IconAlert,
  IconArrow,
  IconCheck,
  IconDash,
  IconPlay,
  IconX,
  SeverityTag,
  VerdictBadge,
} from "./ui";

// ---------------------------------------------------------------- verdict

export function VerdictPanel({ report }: { report: Report }) {
  const counts = { high: 0, medium: 0, low: 0 };
  report.findings.forEach((f) => counts[f.severity]++);
  const tokens = (report.usage.input_tokens ?? 0) + (report.usage.output_tokens ?? 0);
  return (
    <div className="card verdict-panel fade-in">
      <div className="verdict-row">
        <VerdictBadge verdict={report.verdict} size="lg" />
        <span className="section-label">Agent verdict</span>
        <div className="sev-counts">
          {(["high", "medium", "low"] as const).map((s) =>
            counts[s] ? (
              <span key={s} className={`tag sev sev-${s}`}>
                <span className="tnum">{counts[s]}</span> {s}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <p className="summary">{report.summary}</p>
      <div className="verdict-stats">
        <span>
          <b>{report.findings.length}</b> findings
        </span>
        <span>
          <b>{report.latency_s.toFixed(1)}s</b> latency
        </span>
        {tokens > 0 && (
          <span>
            <b>{tokens.toLocaleString()}</b> tokens
          </span>
        )}
        <span className="mono">{report.model}</span>
      </div>
      <div className="disclaimer">Findings are flagged for human review. They are not legal conclusions.</div>
    </div>
  );
}

// ---------------------------------------------------------------- findings

interface FindingCardProps {
  finding: Finding;
  index: number;
  active: boolean;
  status?: "matched" | "duplicate" | "false_flag" | "neutral";
  isVideo: boolean;
  onSeek: (t: number) => void;
  onSelect: (i: number) => void;
}

export function FindingCard({ finding: f, index, active, status, isVideo, onSeek, onSelect }: FindingCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);
  const frame = mediaUrl(f.frame_path);
  return (
    <div
      ref={ref}
      id={`finding-${index}`}
      className={`finding sev-${f.severity} ${active ? "active" : ""}`}
      onClick={() => onSelect(index)}
    >
      <div className="finding-head">
        <SeverityTag severity={f.severity} />
        <span className="cat">{CATEGORY_LABEL[f.category] ?? f.category}</span>
        {status === "false_flag" && <span className="tag sev sev-medium">Not in golden set</span>}
        {status === "duplicate" && <span className="tag">Duplicate</span>}
        <div className="right">
          <ChannelTag channel={f.evidence_channel} />
          {isVideo && f.timestamp_s && (
            <button
              className="ts-btn"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(index);
                onSeek(f.timestamp_s![0]);
              }}
              title="Seek video to this moment"
            >
              <IconPlay size={10} />
              {fmtRange(f.timestamp_s)}
            </button>
          )}
        </div>
      </div>
      <div className={`finding-body ${frame ? "with-frame" : ""}`}>
        <div style={{ gridArea: "fix", minWidth: 0 }}>
          {f.suggested_fix ? (
            <div className="fix">
              <div className="fix-box before">
                <span className="section-label">Flagged</span>
                <p>{f.claim}</p>
              </div>
              <div className="fix-arrow">
                <IconArrow size={16} />
              </div>
              <div className="fix-box after">
                <span className="section-label">Suggested</span>
                <p>{stripReplace(f.suggested_fix)}</p>
              </div>
            </div>
          ) : (
            <p className="claim">{f.claim}</p>
          )}
        </div>
        <div style={{ gridArea: "why", display: "grid", gap: 8, minWidth: 0, alignContent: "start" }}>
          <p className="rationale">{f.rationale}</p>
          <div className="rule">
            <span className="sect">§</span>
            <span>{f.rule}</span>
          </div>
        </div>
        {frame && (
          <button
            className="frame-thumb"
            style={{ gridArea: "frame" }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(index);
              if (f.timestamp_s) onSeek(f.timestamp_s[0]);
            }}
            title="Frame the reviewer saw"
          >
            <img src={frame} alt={`Frame for ${CATEGORY_LABEL[f.category]}`} loading="lazy" />
            <div className="cap">{frameCaption(f)}</div>
          </button>
        )}
      </div>
    </div>
  );
}

const stripReplace = (s: string) => s.replace(/^Replace with:\s*/i, "").replace(/^[“"](.*)[”"]$/s, "$1");

function frameCaption(f: Finding): string {
  const m = /t(\d+(?:\.\d+)?)\.jpg$/.exec(f.frame_path ?? "");
  if (m) return `frame @ ${fmtTime(Number(m[1]))}`;
  return f.timestamp_s ? `frame near ${fmtTime(f.timestamp_s[0])}` : "frame";
}

// ---------------------------------------------------------------- golden labels

interface GoldenProps {
  gc: GoldenCase;
  report: Report;
  cmp: GoldenComparison;
  onJump: (findingIndex: number) => void;
}

export function GoldenPanel({ gc, report, cmp, onJump }: GoldenProps) {
  const falseFlags = cmp.predStatus.map((s, i) => (s === "false_flag" ? i : -1)).filter((i) => i >= 0);
  const missed = cmp.rows.filter((r) => r.required && r.match === null).length;
  return (
    <div className="card fade-in">
      <div className="card-head">
        <h2>Golden labels</h2>
        <span className="right">
          Expected <VerdictBadge verdict={gc.expected_verdict} />
        </span>
      </div>
      <div className="golden-summary">
        <span className={`stat-chip ${cmp.verdictOk ? "good" : "bad"}`}>
          {cmp.verdictOk ? <IconCheck size={12} /> : <IconX size={12} />}
          <b>Verdict</b> {cmp.verdictOk ? "matches" : `got ${VERDICT_LABEL[report.verdict].toLowerCase()}`}
        </span>
        <span className={`stat-chip ${cmp.mustCatchTotal === 0 ? "" : missed ? "bad" : "good"}`}>
          <b className="tnum">
            {cmp.mustCatchHit}/{cmp.mustCatchTotal}
          </b>
          must-catch found
        </span>
        <span className={`stat-chip ${falseFlags.length ? "bad" : "good"}`}>
          <b className="tnum">{falseFlags.length}</b>
          {gc.expected_verdict === "compliant" ? "false flags on a compliant control" : "extra (not in golden)"}
        </span>
      </div>
      {cmp.rows.length === 0 && (
        <div className="notes">
          No violations expected: this is a compliant control. Any finding here counts as a false flag.
        </div>
      )}
      {cmp.rows.map((r, i) => {
        const state = r.match !== null ? "matched" : r.required ? "missed" : "optional";
        return (
          <div
            key={i}
            className={`g-row ${r.match !== null ? "clickable" : ""}`}
            onClick={() => r.match !== null && onJump(r.match)}
          >
            <span className={`g-icon ${state}`}>
              {state === "matched" ? <IconCheck size={11} /> : state === "missed" ? <IconX size={11} /> : <IconDash size={11} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="g-title">{CATEGORY_LABEL[r.golden.category]}</div>
              <div className="g-claim">{r.golden.claim}</div>
            </div>
            <div className="g-status" style={{ color: stateColor(state) }}>
              {state === "matched" ? "Found" : state === "missed" ? "Missed" : "Not found"}
              <small>
                {r.required ? "must-catch" : "optional"}
                {r.golden.timestamp_s ? ` · ${fmtRange(r.golden.timestamp_s)}` : ""}
              </small>
            </div>
          </div>
        );
      })}
      {falseFlags.length > 0 && (
        <>
          <div className="g-sub section-label">Flagged by agent, not in golden set</div>
          {falseFlags.map((fi) => {
            const f = report.findings[fi];
            return (
              <div key={fi} className="g-row clickable" onClick={() => onJump(fi)}>
                <span className="g-icon extra">
                  <IconAlert size={11} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="g-title">{CATEGORY_LABEL[f.category]}</div>
                  <div className="g-claim">{f.claim}</div>
                </div>
                <div className="g-status" style={{ color: "var(--medium)" }}>
                  {gc.expected_verdict === "compliant" ? "False flag" : "Extra"}
                  <small>{f.severity}</small>
                </div>
              </div>
            );
          })}
        </>
      )}
      {gc.must_not_flag.length > 0 && (
        <details className="notes-wrap">
          <summary className="g-sub section-label" style={{ borderBottom: 0, borderTop: "1px solid var(--line)" }}>
            <span className="chev">▸</span> Must not flag ({gc.must_not_flag.length})
          </summary>
          <ul className="notes" style={{ margin: 0, paddingLeft: 32 }}>
            {gc.must_not_flag.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const stateColor = (s: string) =>
  s === "matched" ? "var(--ok)" : s === "missed" ? "var(--high)" : "var(--ink-3)";

// ---------------------------------------------------------------- transcript

interface TranscriptProps {
  segments: TranscriptSegment[];
  findings: Finding[];
  currentTime: number;
  follow: boolean;
  onSeek: (t: number) => void;
}

export function Transcript({ segments, findings, currentTime, follow, onSeek }: TranscriptProps) {
  const box = useRef<HTMLDivElement>(null);
  const flagged = useMemo(() => {
    // Whole-ad omissions (e.g. "no risk info anywhere") span everything; highlighting every line says nothing.
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
  }, [segments, findings]);
  const nowIdx = segments.findIndex((s) => currentTime >= s.start && currentTime < s.end);

  useEffect(() => {
    if (!follow || nowIdx < 0 || !box.current) return;
    const el = box.current.children[nowIdx] as HTMLElement | undefined;
    if (!el) return;
    const b = box.current;
    if (el.offsetTop < b.scrollTop || el.offsetTop + el.offsetHeight > b.scrollTop + b.clientHeight)
      b.scrollTo({ top: el.offsetTop - b.clientHeight / 3, behavior: "smooth" });
  }, [nowIdx, follow]);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Transcript</h2>
        <span className="right">
          <span className="sev-dot sev-high" style={{ borderRadius: 1, width: 3, height: 12 }} /> spoken in a
          flagged window · click a line to seek
        </span>
      </div>
      <div className="transcript" ref={box} style={{ position: "relative" }}>
        {segments.map((s, i) => {
          const f = flagged[i];
          return (
            <div
              key={i}
              className={`seg-line ${f ? `flagged sev-${f.severity}` : ""} ${i === nowIdx ? "now" : ""}`}
              onClick={() => onSeek(s.start)}
              title={f ? CATEGORY_LABEL[f.category] : undefined}
            >
              <span className="t">{fmtTime(s.start)}</span>
              <span>{s.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const rank = (f: Finding) => ({ high: 0, medium: 1, low: 2 })[f.severity];

// ---------------------------------------------------------------- stepper

interface StepperProps {
  stages: Stage[];
  current: Stage; // last non-error stage seen
  error: string | null; // set when the job failed during `current`
  elapsed: number;
}

export function Stepper({ stages, current, error, elapsed }: StepperProps) {
  const failedAt = error !== null;
  const curIdx = current === "queued" ? (failedAt ? 0 : -1) : stages.indexOf(current);
  return (
    <ol className="stepper">
      {stages.map((s, i) => {
        const state =
          current === "done" || i < curIdx ? "done" : i === curIdx ? (failedAt ? "failed" : "current") : "";
        return (
          <li key={s} className={`step ${state}`}>
            <span className="step-dot">{state === "done" ? <IconCheck size={11} /> : state === "failed" ? <IconX size={11} /> : null}</span>
            <span>{STAGE_LABEL[s]}</span>
            {state === "current" && <span className="elapsed">{elapsed.toFixed(0)}s</span>}
          </li>
        );
      })}
      {error && <div className="error-box">{error}</div>}
    </ol>
  );
}
