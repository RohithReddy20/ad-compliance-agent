import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { CaseRail, shortCompany } from "../components/CaseRail";
import { FindingCard, GoldenPanel, Stepper, Transcript, VerdictPanel } from "../components/Report";
import { IconExternal, IconPlay, IconShield } from "../components/ui";
import { VideoEvidence } from "../components/VideoEvidence";
import { SOURCE_LABEL, compareGolden, fmtTime, humanize, sortFindings, stagesFor } from "../lib";
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
  selectedId: string | null | undefined; // null = "New ad", undefined = not chosen yet
  navigate: (hash: string) => void;
}

export function ReviewPage({ cases, casesError, selectedId, navigate }: Props) {
  const gc = useMemo(() => cases.find((c) => c.id === selectedId) ?? null, [cases, selectedId]);

  return (
    <div className="review">
      <CaseRail
        cases={cases}
        selectedId={selectedId ?? null}
        onSelect={(id) => navigate(`#/review/${id}`)}
        onNew={() => navigate("#/review/new")}
        newActive={selectedId === null}
      />
      <main className="main">
        {casesError && (
          <div className="main-inner">
            <div className="error-box">Could not load cases: {casesError}</div>
          </div>
        )}
        {selectedId === undefined ? (
          !casesError && <div className="loading">Loading cases…</div>
        ) : selectedId === null ? (
          <Workspace key="new" gc={null} />
        ) : gc ? (
          <Workspace key={gc.id} gc={gc} />
        ) : (
          !casesError && <div className="loading">Loading…</div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- workspace

interface Upload {
  modality: Modality;
  text: string;
  file: File | null;
  url: string | null;
}

function Workspace({ gc }: { gc: CaseWithAsset | null }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loadingReport, setLoadingReport] = useState(!!gc);
  const [job, setJob] = useState<JobState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [upload, setUpload] = useState<Upload | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(gc?.duration_s ?? 0);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  const modality: Modality = gc?.modality ?? upload?.modality ?? "text";

  // cached report
  useEffect(() => {
    if (!gc) return;
    let live = true;
    api
      .getReport(gc.id)
      .then((r) => live && setReport(r))
      .catch(() => live && setReport(null))
      .finally(() => live && setLoadingReport(false));
    return () => {
      live = false;
    };
  }, [gc]);

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
            setReport(j.report);
            setActive(null);
          }
        }
      } catch (e) {
        setJob((s) => s && { ...s, error: (e as Error).message });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, job?.jobId]); // eslint-disable-line react-hooks/exhaustive-deps -- re-arm only per job

  const start = async (req: ReviewRequest) => {
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

  const select = useCallback((i: number) => setActive(i), []);
  const selectAndSeek = useCallback(
    (i: number) => {
      setActive(i);
      const ts = report?.findings[i]?.timestamp_s;
      if (ts) seek(ts[0]);
    },
    [report, seek],
  );

  const ordered = useMemo(() => {
    if (!report) return [];
    const sorted = sortFindings(report.findings);
    return sorted.map((f) => ({ f, i: report.findings.indexOf(f) }));
  }, [report]);

  const cmp = useMemo(
    () => (gc && report ? compareGolden(gc, report.findings, report.verdict) : null),
    [gc, report],
  );

  const assetSrc = gc ? gc.asset_url : upload?.url ?? null;
  const copy = gc ? (gc.modality === "text" ? gc.ad_content : null) : upload?.modality === "text" ? upload.text : null;
  const showRunPanel = job !== null && (running || job.error !== null);
  const showUploadForm = !gc && !job && !report;

  return (
    <div className="main-inner">
      {gc ? (
        <CaseHeader gc={gc} hasReport={!!report} running={running} onRun={() => start({ kind: "case", case_id: gc.id })} />
      ) : (
        <div className="case-head">
          <div>
            <div className="section-label">New ad</div>
            <h1>{upload?.file?.name ?? (upload ? "Pasted ad copy" : "Review an ad before it ships")}</h1>
            <div className="meta-row">Upload a video or image, or paste ad copy. Nothing is published.</div>
          </div>
          {(report || job?.error) && (
            <div className="case-head-actions">
              <button
                className="btn"
                onClick={() => {
                  setReport(null);
                  setJob(null);
                  setUpload(null);
                }}
              >
                Start over
              </button>
            </div>
          )}
        </div>
      )}

      {showUploadForm ? (
        <NewAdForm
          onSubmit={(u, req) => {
            setUpload(u);
            if (u.modality === "video") setDuration(0);
            void start(req);
          }}
        />
      ) : (
        <div className="workspace">
          <div className="col sticky">
            {modality === "video" && assetSrc && (
              <VideoEvidence
                src={assetSrc}
                videoRef={videoRef}
                duration={duration || report?.transcript.at(-1)?.end || 0}
                currentTime={currentTime}
                playing={playing}
                findings={report?.findings ?? []}
                frames={report?.frames ?? []}
                activeFinding={active}
                onSeek={seek}
                onSelectFinding={selectAndSeek}
                onTime={setCurrentTime}
                onDuration={setDuration}
                onPlaying={setPlaying}
              />
            )}
            {modality === "image" && assetSrc && (
              <div className="card">
                <div className="card-head">
                  <h2>Image ad</h2>
                </div>
                <div className="image-asset" style={{ borderRadius: "0 0 8px 8px" }}>
                  <img src={assetSrc} alt={gc?.title ?? "Uploaded ad"} />
                </div>
              </div>
            )}
            {copy !== null && (
              <div className="card">
                <div className="card-head">
                  <h2>Ad copy</h2>
                  {report && <span className="right">flagged passages are highlighted</span>}
                </div>
                <HighlightedCopy text={copy} findings={report?.findings ?? []} active={active} onSelect={select} />
              </div>
            )}
            {modality === "video" && report && report.transcript.length > 0 && (
              <Transcript
                segments={report.transcript}
                findings={report.findings}
                currentTime={currentTime}
                follow={playing}
                onSeek={seek}
              />
            )}
            {gc && gc.modality !== "text" && <SourceContent gc={gc} />}
          </div>

          <div className="col">
            {showRunPanel && job && (
              <div className="card run-panel fade-in">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconShield size={16} />
                  <b>{job.error ? "Review failed" : "Reviewing…"}</b>
                  <span className="muted mono" style={{ marginLeft: "auto" }}>
                    {job.jobId ? `job ${job.jobId}` : "starting"}
                  </span>
                </div>
                <Stepper
                  stages={stagesFor(modality)}
                  current={job.stage}
                  error={job.error}
                  elapsed={(now - job.started) / 1000}
                />
              </div>
            )}

            {loadingReport && !report && <div className="card empty muted">Loading last review…</div>}

            {!loadingReport && !report && !job && gc && (
              <div className="card empty">
                <h3>Not reviewed yet</h3>
                <p>
                  Run the agent on this {gc.modality} ad.{" "}
                  {gc.modality === "video"
                    ? "It transcribes the audio, picks frames worth looking at, extracts every claim and judges each against FDA/FTC rules."
                    : "It extracts every claim and judges each against FDA/FTC rules."}
                </p>
                <button className="btn primary" onClick={() => start({ kind: "case", case_id: gc.id })}>
                  <IconPlay size={12} /> Run review
                </button>
              </div>
            )}

            {report && (
              <>
                <VerdictPanel report={report} />
                {gc && cmp && (
                  <GoldenPanel
                    gc={gc}
                    report={report}
                    cmp={cmp}
                    onJump={(i) => (modality === "video" ? selectAndSeek(i) : select(i))}
                  />
                )}
                <div className="findings">
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                    <span className="section-label">Findings</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      sorted by severity{modality === "video" ? ", then time" : ""}
                    </span>
                  </div>
                  {ordered.length === 0 && (
                    <div className="card empty">
                      <h3>No issues flagged</h3>
                      <p>The reviewer found no claims that break the rules it checks.</p>
                    </div>
                  )}
                  {ordered.map(({ f, i }) => (
                    <FindingCard
                      key={i}
                      finding={f}
                      index={i}
                      active={active === i}
                      status={cmp?.predStatus[i]}
                      isVideo={modality === "video"}
                      onSeek={seek}
                      onSelect={select}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- header

function CaseHeader({
  gc,
  hasReport,
  running,
  onRun,
}: {
  gc: CaseWithAsset;
  hasReport: boolean;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <div className="case-head">
      <div style={{ minWidth: 0 }}>
        <div className="section-label">
          {SOURCE_LABEL[gc.source_type] ?? humanize(gc.source_type)} · <span className="mono">{gc.id}</span>
        </div>
        <h1>{gc.title}</h1>
        <div className="meta-row">
          <span>{shortCompany(gc.company)}</span>
          <span className="sep" />
          <span>{humanize(gc.vertical)}</span>
          {gc.duration_s != null && (
            <>
              <span className="sep" />
              <span className="tnum">{fmtTime(gc.duration_s)}</span>
            </>
          )}
          {gc.source_url && (
            <>
              <span className="sep" />
              <a href={gc.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                Source <IconExternal size={12} />
              </a>
            </>
          )}
        </div>
      </div>
      <div className="case-head-actions">
        <button className="btn primary" onClick={onRun} disabled={running}>
          <IconPlay size={12} /> {running ? "Reviewing…" : hasReport ? "Re-run review" : "Run review"}
        </button>
      </div>
    </div>
  );
}

function SourceContent({ gc }: { gc: CaseWithAsset }) {
  return (
    <details className="card notes-wrap">
      <summary className="card-head" style={{ borderBottom: 0 }}>
        <span className="chev">▸</span>
        <h2>Source transcript &amp; labeller notes</h2>
      </summary>
      <div className="notes" style={{ borderTop: "1px solid var(--line)", whiteSpace: "pre-wrap" }}>
        {gc.ad_content}
        {gc.notes && (
          <>
            <div className="section-label" style={{ margin: "12px 0 4px" }}>
              Notes
            </div>
            {gc.notes}
          </>
        )}
      </div>
    </details>
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
                className={`sev-${findings[part.i].severity} ${active === part.i ? "active" : ""}`}
                onClick={() => onSelect(part.i!)}
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
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (f && (f.type.startsWith("video/") || f.type.startsWith("image/"))) setFile(f);
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

  return (
    <div className="card" style={{ padding: 22, maxWidth: 760 }}>
      <div
        className={`dropzone ${over ? "over" : ""}`}
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
        <input
          ref={input}
          type="file"
          accept="video/*,image/*"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <div>
            <b>{file.name}</b>
            <div className="muted" style={{ fontSize: 12 }}>
              {file.type} · {(file.size / 1e6).toFixed(1)} MB · click to replace
            </div>
          </div>
        ) : (
          <div>
            <b>Drop a video or image ad</b>
            <div className="muted" style={{ fontSize: 12 }}>
              mp4, mov, webm, png, jpg · or click to browse
            </div>
          </div>
        )}
      </div>
      <div className="or">{file ? "optional landing-page or caption copy" : "or paste ad copy"}</div>
      <textarea
        className="paste"
        placeholder="e.g. Same active ingredient as Ozempic®, at a fraction of the price…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, gap: 8 }}>
        {file && (
          <button className="btn ghost" onClick={() => setFile(null)}>
            Remove file
          </button>
        )}
        <button className="btn primary" disabled={!file && !text.trim()} onClick={submit}>
          <IconPlay size={12} /> Run review
        </button>
      </div>
    </div>
  );
}

