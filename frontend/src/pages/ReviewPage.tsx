import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { EmptyStrip, FindingsList, GoldenTab, RunStrip, TranscriptTab, VerdictStrip } from "../components/Report";
import { IconChevron, IconExternal, IconPlay } from "../components/ui";
import { VideoEvidence } from "../components/VideoEvidence";
import {
  MODALITY_LABEL,
  MODALITY_ORDER,
  SOURCE_LABEL,
  compareGolden,
  fmtTime,
  humanize,
  inLibraryOrder,
  shortCompany,
  sortFindings,
  stagesFor,
  truncate,
} from "../lib";
import type { CaseWithAsset, Finding, Modality, Report, ReviewRequest, Stage } from "../types";

interface JobState {
  jobId: string;
  adId: string;
  stage: Stage; // last non-error stage seen
  error: string | null;
  started: number;
}

interface Props {
  cases: CaseWithAsset[];
  casesError: string | null;
  selectedId: string | null; // null = a new ad
  navigate: (hash: string) => void;
}

export function ReviewPage({ cases, casesError, selectedId, navigate }: Props) {
  const gc = useMemo(() => cases.find((c) => c.id === selectedId) ?? null, [cases, selectedId]);

  if (selectedId === null) return <Workspace key="new" gc={null} cases={cases} navigate={navigate} />;
  if (gc) return <Workspace key={gc.id} gc={gc} cases={cases} navigate={navigate} />;
  return (
    <main className="page" id="main">
      <a className="back" href="#/">
        <IconChevron size={14} className="flip" /> Ad library
      </a>
      {casesError ? (
        <div className="error-box">Could not load the ads: {casesError}</div>
      ) : cases.length ? (
        <div className="panel-empty">
          <h3>No ad with the id “{selectedId}”</h3>
          <p>It may have been removed from the golden set.</p>
          <a className="btn" href="#/">
            Back to the ad library
          </a>
        </div>
      ) : (
        <div className="loading">Loading…</div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- workspace

interface Upload {
  modality: Modality;
  text: string;
  file: File | null;
  url: string | null;
}

type Tab = "findings" | "golden" | "transcript" | "notes";

function Workspace({
  gc,
  cases,
  navigate,
}: {
  gc: CaseWithAsset | null;
  cases: CaseWithAsset[];
  navigate: (hash: string) => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [loadingReport, setLoadingReport] = useState(!!gc);
  const [job, setJob] = useState<JobState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [upload, setUpload] = useState<Upload | null>(null);
  const [lastReq, setLastReq] = useState<ReviewRequest | null>(null);
  const [tab, setTab] = useState<Tab>("findings");

  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(gc?.duration_s ?? 0);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  const modality: Modality = gc?.modality ?? upload?.modality ?? "text";
  const isVideo = modality === "video";

  const ordered = useMemo(() => {
    if (!report) return [];
    return sortFindings(report.findings).map((f) => ({ f, i: report.findings.indexOf(f) }));
  }, [report]);

  // open the most severe finding as soon as a report arrives, so the panel is never a wall of closed rows
  const showReport = useCallback((r: Report | null) => {
    setReport(r);
    const first = r ? sortFindings(r.findings)[0] : undefined;
    setActive(r && first ? r.findings.indexOf(first) : null);
  }, []);

  // cached report
  useEffect(() => {
    if (!gc) return;
    let live = true;
    api
      .getReport(gc.id)
      .then((r) => live && showReport(r))
      .catch(() => live && showReport(null))
      .finally(() => live && setLoadingReport(false));
    return () => {
      live = false;
    };
  }, [gc, showReport]);

  // poll the job every second
  const running = job !== null && job.error === null && job.stage !== "done";
  useEffect(() => {
    if (!running || !job) return;
    const id = setInterval(async () => {
      setNow(Date.now());
      try {
        const j = await api.getJob(job.jobId);
        if (j.stage === "error") {
          setJob((s) => s && { ...s, error: j.error ?? "Review failed" });
        } else {
          setJob((s) => s && { ...s, stage: j.stage });
          if (j.stage === "done" && j.report) {
            showReport(j.report);
            setTab("findings");
          }
        }
      } catch (e) {
        setJob((s) => s && { ...s, error: (e as Error).message });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, job?.jobId, showReport]); // eslint-disable-line react-hooks/exhaustive-deps -- re-arm only per job

  const start = async (req: ReviewRequest) => {
    setLastReq(req);
    setJob({ jobId: "", adId: "", stage: "queued", error: null, started: Date.now() });
    try {
      const j = await api.createReview(req);
      setJob({ jobId: j.job_id, adId: j.ad_id, stage: j.stage, error: null, started: Date.now() });
    } catch (e) {
      setJob({ jobId: "", adId: "", stage: "queued", error: (e as Error).message, started: Date.now() });
    }
  };

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setCurrentTime(t);
  }, []);

  /** Select a finding, show it in the list, and (for video) move to the moment it happens. */
  const pick = useCallback(
    (i: number | null) => {
      setActive(i);
      if (i === null) return;
      setTab("findings");
      const ts = report?.findings[i]?.timestamp_s;
      if (isVideo && ts) seek(ts[0]);
    },
    [report, isVideo, seek],
  );

  // J / K step through findings, the way a reviewer works down a list
  useEffect(() => {
    if (!ordered.length) return;
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k") return;
      const at = ordered.findIndex((x) => x.i === active);
      const next = k === "j" ? Math.min(ordered.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
      pick(ordered[next].i);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [ordered, active, pick]);

  const cmp = useMemo(
    () => (gc && report ? compareGolden(gc, report.findings, report.verdict) : null),
    [gc, report],
  );

  const assetSrc = gc ? gc.asset_url : upload?.url ?? null;
  const copy = gc ? (gc.modality === "text" ? gc.ad_content : null) : upload?.modality === "text" ? upload.text : null;
  const showRun = job !== null && (running || job.error !== null);
  const showUploadForm = !gc && !job && !report;
  const runCase = () => (gc ? start({ kind: "case", case_id: gc.id }) : lastReq ? start(lastReq) : undefined);

  const tabs: { id: Tab; label: string; count?: string }[] = [
    { id: "findings", label: "Findings", count: report ? String(report.findings.length) : undefined },
    ...(gc && cmp
      ? [{ id: "golden" as const, label: "Golden labels", count: `${cmp.mustCatchHit}/${cmp.mustCatchTotal}` }]
      : []),
    ...(isVideo && report && report.transcript.length ? [{ id: "transcript" as const, label: "Transcript" }] : []),
    ...(gc && (gc.notes || gc.modality !== "text") ? [{ id: "notes" as const, label: "Case notes" }] : []),
  ];
  const tabNow = tabs.some((t) => t.id === tab) ? tab : "findings";

  return (
    <main className={`ws ${showUploadForm ? "ws-form" : ""}`} id="main">
      <header className="ws-head">
        <div className="ws-crumbs">
          <a className="back" href="#/">
            <IconChevron size={14} className="flip" /> Ad library
          </a>
          {gc && <CaseSwitcher cases={cases} id={gc.id} onPick={(id) => navigate(`#/review/${id}`)} />}
        </div>
        <div className="ws-title">
          <div className="ws-title-text">
            <h1>{gc ? gc.title : upload?.file?.name ?? (upload ? "Pasted ad copy" : "Review an ad before it ships")}</h1>
            {gc ? (
              <div className="meta-row">
                <span className="kind">
                  {SOURCE_LABEL[gc.source_type] ?? humanize(gc.source_type)}
                  <b className="tnum">{gc.id}</b>
                </span>
                <span>{shortCompany(gc.company)}</span>
                <span>{humanize(gc.vertical)}</span>
                {gc.duration_s != null && <span className="tnum">{fmtTime(gc.duration_s)} long</span>}
                {gc.source_url && (
                  <a href={gc.source_url} target="_blank" rel="noreferrer">
                    Source <IconExternal size={12} />
                  </a>
                )}
              </div>
            ) : (
              <div className="meta-row">
                <span>Upload a video or image, or paste ad copy. Nothing is published.</span>
              </div>
            )}
          </div>
          <div className="ws-actions">
            {!gc && (report || job?.error) && (
              <button
                className="btn"
                onClick={() => {
                  showReport(null);
                  setJob(null);
                  setUpload(null);
                }}
              >
                Start over
              </button>
            )}
            {report && !showRun && (gc || lastReq) && (
              <button className="btn" onClick={runCase}>
                <IconPlay size={11} /> Run again
              </button>
            )}
          </div>
        </div>
      </header>

      {showUploadForm ? (
        <NewAdForm
          onSubmit={(u, req) => {
            setUpload(u);
            if (u.modality === "video") setDuration(0);
            void start(req);
          }}
        />
      ) : (
        <>
          {showRun && job ? (
            <RunStrip
              stages={stagesFor(modality)}
              current={job.stage}
              error={job.error}
              elapsed={(now - job.started) / 1000}
              jobId={job.jobId}
              onRetry={() => void runCase()}
            />
          ) : report ? (
            <VerdictStrip report={report} cmp={cmp} onShowGolden={() => setTab("golden")} />
          ) : (
            <EmptyStrip modality={modality} loading={loadingReport} onRun={() => void runCase()} />
          )}

          <div className="ws-body">
            <section className="stage" aria-label="The ad">
              {isVideo && assetSrc && (
                <VideoEvidence
                  src={assetSrc}
                  videoRef={videoRef}
                  duration={duration || report?.transcript.at(-1)?.end || 0}
                  currentTime={currentTime}
                  playing={playing}
                  findings={report?.findings ?? []}
                  frames={report?.frames ?? []}
                  segments={report?.transcript ?? []}
                  activeFinding={active}
                  onSeek={seek}
                  onSelectFinding={pick}
                  onTime={setCurrentTime}
                  onDuration={setDuration}
                  onPlaying={setPlaying}
                />
              )}
              {modality === "image" && assetSrc && (
                <div className="image-asset">
                  <img src={assetSrc} alt={gc?.title ?? "Uploaded ad"} />
                </div>
              )}
              {copy !== null && (
                <div className="copy-stage">
                  <div className="stage-head">
                    <h2>Ad copy</h2>
                    {report && report.findings.length > 0 && (
                      <span className="muted">Flagged passages are underlined. Select one to see why.</span>
                    )}
                  </div>
                  <HighlightedCopy text={copy} findings={report?.findings ?? []} active={active} onSelect={pick} />
                </div>
              )}
            </section>

            <aside className="panel" aria-label="Review details">
              <div className="tabs" role="tablist" aria-label="Review details">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={tabNow === t.id}
                    aria-controls="panel-body"
                    className={tabNow === t.id ? "on" : ""}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                    {t.count !== undefined && <span className="count tnum">{t.count}</span>}
                  </button>
                ))}
                {tabNow === "findings" && ordered.length > 1 && (
                  <span className="tabs-hint">
                    <kbd>J</kbd> <kbd>K</kbd> to step through
                  </span>
                )}
              </div>
              <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`tab-${tabNow}`}>
                {tabNow === "findings" &&
                  (report ? (
                    <FindingsList
                      items={ordered}
                      active={active}
                      status={cmp?.predStatus}
                      isVideo={isVideo}
                      onSelect={pick}
                      onSeek={seek}
                    />
                  ) : (
                    <div className="panel-empty">
                      <h3>{running ? "Findings are on their way" : "No findings yet"}</h3>
                      <p>
                        {running
                          ? "Each flagged claim will appear here with the rule it breaks and a suggested rewrite."
                          : "Run the review to see each flagged claim, the rule it breaks and a suggested rewrite."}
                      </p>
                    </div>
                  ))}
                {tabNow === "golden" && gc && cmp && report && (
                  <GoldenTab gc={gc} report={report} cmp={cmp} onJump={pick} />
                )}
                {tabNow === "transcript" && report && (
                  <TranscriptTab
                    segments={report.transcript}
                    findings={report.findings}
                    currentTime={currentTime}
                    follow={playing}
                    onSeek={seek}
                  />
                )}
                {tabNow === "notes" && gc && <CaseNotes gc={gc} />}
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- header pieces

function CaseSwitcher({ cases, id, onPick }: { cases: CaseWithAsset[]; id: string; onPick: (id: string) => void }) {
  const ordered = useMemo(() => inLibraryOrder(cases), [cases]);
  const at = ordered.findIndex((c) => c.id === id);
  return (
    <div className="switcher">
      <button className="icon-btn" disabled={at <= 0} onClick={() => onPick(ordered[at - 1].id)} aria-label="Previous ad">
        <IconChevron size={16} className="flip" />
      </button>
      <select value={id} onChange={(e) => onPick(e.target.value)} aria-label="Switch to another ad">
        {MODALITY_ORDER.map((m) => (
          <optgroup key={m} label={`${MODALITY_LABEL[m]} ads`}>
            {ordered
              .filter((c) => c.modality === m)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}: {truncate(c.title, 64)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <button
        className="icon-btn"
        disabled={at < 0 || at >= ordered.length - 1}
        onClick={() => onPick(ordered[at + 1].id)}
        aria-label="Next ad"
      >
        <IconChevron size={16} />
      </button>
      <span className="muted tnum">
        {at + 1} of {ordered.length}
      </span>
    </div>
  );
}

function CaseNotes({ gc }: { gc: CaseWithAsset }) {
  return (
    <div className="case-notes">
      {gc.notes && (
        <>
          <h3 className="panel-sub">Labeller notes</h3>
          <p className="notes">{gc.notes}</p>
        </>
      )}
      {gc.modality !== "text" && gc.ad_content && (
        <>
          <h3 className="panel-sub">Source transcript</h3>
          <p className="notes pre">{gc.ad_content}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- text highlighting

function HighlightedCopy({
  text,
  findings,
  active,
  onSelect,
}: {
  text: string;
  findings: Finding[];
  active: number | null;
  onSelect: (i: number) => void;
}) {
  const paragraphs = useMemo(() => {
    const lower = text.toLowerCase();
    const ranges: { s: number; e: number; i: number }[] = [];
    const order = findings.map((f, i) => ({ f, i })).sort((a, b) => rankSev(a.f) - rankSev(b.f));
    for (const { f, i } of order) {
      const needle = f.claim.replace(/^[“"]|[”"]$/g, "").trim().toLowerCase();
      if (needle.length < 4) continue;
      const s = lower.indexOf(needle);
      if (s < 0) continue;
      const e = s + needle.length;
      if (ranges.some((r) => s < r.e && e > r.s)) continue;
      ranges.push({ s, e, i });
    }
    ranges.sort((a, b) => a.s - b.s);
    // split into paragraphs while keeping absolute offsets
    const out: { key: number; parts: { t: string; i: number | null }[] }[] = [];
    let offset = 0;
    text.split("\n").forEach((line, li) => {
      const start = offset;
      const end = offset + line.length;
      const parts: { t: string; i: number | null }[] = [];
      let cur = start;
      for (const r of ranges) {
        if (r.e <= start || r.s >= end) continue;
        const s = Math.max(r.s, start);
        const e = Math.min(r.e, end);
        if (s > cur) parts.push({ t: text.slice(cur, s), i: null });
        parts.push({ t: text.slice(s, e), i: r.i });
        cur = e;
      }
      if (cur < end) parts.push({ t: text.slice(cur, end), i: null });
      out.push({ key: li, parts });
      offset = end + 1;
    });
    return out;
  }, [text, findings]);

  return (
    <div className="copy-asset">
      {paragraphs.map((p) => (
        <p key={p.key}>
          {p.parts.map((part, k) =>
            part.i === null ? (
              <span key={k}>{part.t}</span>
            ) : (
              <mark
                key={k}
                role="button"
                tabIndex={0}
                className={`sev-${findings[part.i].severity} ${active === part.i ? "active" : ""}`}
                onClick={() => onSelect(part.i!)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(part.i!);
                  }
                }}
              >
                {part.t}
              </mark>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

const rankSev = (f: Finding) => ({ high: 0, medium: 1, low: 2 })[f.severity];

// ---------------------------------------------------------------- new ad

function NewAdForm({ onSubmit }: { onSubmit: (u: Upload, req: ReviewRequest) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.type.startsWith("video/") || f.type.startsWith("image/")) {
      setFile(f);
      setRejected(null);
    } else setRejected(`“${f.name}” is not a video or an image. Use mp4, mov, webm, png or jpg.`);
  };

  const submit = () => {
    if (file) {
      const modality: Modality = file.type.startsWith("video/") ? "video" : "image";
      onSubmit(
        { modality, text, file, url: URL.createObjectURL(file) },
        { kind: "file", file, text: text.trim() || undefined },
      );
    } else if (text.trim()) {
      onSubmit({ modality: "text", text, file: null, url: null }, { kind: "text", text });
    }
  };

  const ready = !!file || !!text.trim();

  return (
    <div className="new-ad-layout">
    <form
      className="card new-ad"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="field">
        <span className="field-label" id="drop-label">
          Video or image ad
        </span>
        <button
          type="button"
          className={`dropzone ${over ? "over" : ""} ${file ? "has-file" : ""}`}
          aria-labelledby="drop-label"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files[0]);
          }}
        >
          {file ? (
            <>
              <b>{file.name}</b>
              <span className="muted">
                {file.type}, {(file.size / 1e6).toFixed(1)} MB. Select to replace it.
              </span>
            </>
          ) : (
            <>
              <b>Drop a file here, or select to browse</b>
              <span className="muted">mp4, mov, webm, png or jpg</span>
            </>
          )}
        </button>
        <input ref={input} type="file" accept="video/*,image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        {rejected && (
          <div className="error-box" role="alert">
            {rejected}
          </div>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="paste">
          {file ? "Caption or landing-page copy (optional)" : "Or paste ad copy"}
        </label>
        <textarea
          id="paste"
          className="paste"
          placeholder="For example: Same active ingredient as Ozempic®, at a fraction of the price…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="form-actions">
        {!ready && <span className="muted">Add a file or some copy to start.</span>}
        {file && (
          <button type="button" className="btn" onClick={() => setFile(null)}>
            Remove file
          </button>
        )}
        <button type="submit" className="btn primary" disabled={!ready}>
          <IconPlay size={12} /> Run review
        </button>
      </div>
    </form>
    <aside className="next-steps">
      <h2>What happens next</h2>
      <ol>
        <li>
          <b>The agent reads the ad.</b> For video it transcribes the audio and picks the frames worth looking at.
        </li>
        <li>
          <b>It extracts every claim</b> from the speech, the on-screen text and the visuals.
        </li>
        <li>
          <b>It checks each claim</b> against FDA and FTC rules and cites the rule it breaks.
        </li>
        <li>
          <b>It drafts a rewrite</b> for each flagged claim, for a person to approve.
        </li>
      </ol>
      <p className="muted">A 30-second video takes about a minute. Findings are flagged for human review.</p>
    </aside>
    </div>
  );
}
