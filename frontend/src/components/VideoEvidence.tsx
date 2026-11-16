import { useMemo, useState, type RefObject } from "react";
import { mediaUrl } from "../api";
import { CATEGORY_LABEL, CHANNEL_LABEL, fmtRange, fmtTime } from "../lib";
import type { Channel, Finding, Frame } from "../types";
import { IconPause, IconPlay } from "./ui";

interface Props {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  duration: number;
  currentTime: number;
  playing: boolean;
  findings: Finding[]; // indexed as in the report
  frames: Frame[];
  activeFinding: number | null;
  onSeek: (t: number) => void;
  onSelectFinding: (i: number) => void;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  onPlaying: (p: boolean) => void;
}

const LANES: Channel[] = ["audio", "on_screen_text", "visual", "copy"];

export function VideoEvidence(p: Props) {
  const { duration } = p;
  const [hoverFrame, setHoverFrame] = useState<Frame | null>(null);
  const [hoverFinding, setHoverFinding] = useState<number | null>(null);

  const lanes = useMemo(() => {
    const present = new Set(p.findings.filter((f) => f.timestamp_s).map((f) => f.evidence_channel));
    // Always show audio + on-screen so an empty lane reads as "nothing found here".
    return LANES.filter((l) => present.has(l) || l === "audio" || l === "on_screen_text").map((l) =>
      pack(p.findings, l),
    );
  }, [p.findings]);

  const ticks = useMemo(() => {
    if (!duration) return [];
    const step = duration > 90 ? 15 : duration > 40 ? 10 : 5;
    const out: number[] = [];
    for (let t = 0; t <= duration + 0.01; t += step) out.push(t);
    return out;
  }, [duration]);

  const pos = (t: number) => `${Math.max(0, Math.min(100, (t / (duration || 1)) * 100))}%`;

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    p.onSeek(((e.clientX - r.left) / r.width) * duration);
  };

  const toggle = () => {
    const v = p.videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <div className="card">
      <div className="player">
        <video
          ref={p.videoRef}
          src={p.src}
          controls
          preload="metadata"
          onTimeUpdate={(e) => p.onTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => p.onDuration(e.currentTarget.duration)}
          onPlay={() => p.onPlaying(true)}
          onPause={() => p.onPlaying(false)}
        />
      </div>
      <div className="timeline">
        <div className="tl-controls">
          <button className="tl-play" onClick={toggle} aria-label={p.playing ? "Pause" : "Play"}>
            {p.playing ? <IconPause size={13} /> : <IconPlay size={13} />}
          </button>
          <span className="tl-time tnum">
            {fmtTime(p.currentTime)} / {fmtTime(duration)}
          </span>
          <div className="tl-legend">
            <span>
              <i className="sev-dot sev-high" /> High
            </span>
            <span>
              <i className="sev-dot sev-medium" /> Medium
            </span>
            <span>
              <i className="sev-dot sev-low" /> Low
            </span>
            <span>
              <i style={{ width: 2, height: 10, background: "var(--ink-2)", display: "inline-block" }} /> Frame
              examined
            </span>
          </div>
        </div>

        <div className="tl-body">
          <div className="tl-labels">
            <div style={{ height: AXIS_H }} />
            <div className="tl-lane-label" style={{ height: FRAMES_H }}>
              Frames
            </div>
            {lanes.map((l) => (
              <div key={l.channel} className="tl-lane-label" style={{ height: laneHeight(l.rows) }}>
                {CHANNEL_LABEL[l.channel]}
              </div>
            ))}
          </div>
          <div className="tl-tracks">
            <div className="tl-axis" style={{ height: AXIS_H }}>
              {ticks.map((t) => (
                <span key={t} style={{ left: pos(t) }}>
                  {fmtTime(t)}
                </span>
              ))}
            </div>
            <div className="tl-track frames" style={{ height: FRAMES_H }} onClick={seekFromEvent}>
              {p.frames.map((f) => (
                <button
                  key={f.path}
                  className="tl-tick"
                  style={{ left: pos(f.t) }}
                  onMouseEnter={() => setHoverFrame(f)}
                  onMouseLeave={() => setHoverFrame(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onSeek(f.t);
                  }}
                  aria-label={`Frame at ${fmtTime(f.t)}: ${f.reason}`}
                />
              ))}
              {hoverFrame && (
                <div className="tl-tip" style={{ left: pos(hoverFrame.t) }}>
                  <img src={mediaUrl(hoverFrame.path) ?? ""} alt="" />
                  <b className="mono" style={{ fontSize: 11 }}>
                    {fmtTime(hoverFrame.t)}
                  </b>{" "}
                  {hoverFrame.reason}
                </div>
              )}
            </div>

            {lanes.map((lane) => (
              <div
                key={lane.channel}
                className="tl-track"
                style={{ height: laneHeight(lane.rows) }}
                onClick={seekFromEvent}
              >
                {lane.items.map(({ i, row }) => {
                  const f = p.findings[i];
                  const ts = f.timestamp_s!;
                  return (
                    <button
                      key={i}
                      className={`tl-bar sev-${f.severity} ${p.activeFinding === i ? "active" : ""}`}
                      style={{
                        top: LANE_PAD + row * (BAR_H + BAR_GAP),
                        height: BAR_H,
                        left: pos(ts[0]),
                        width: `max(6px, calc(${pos(ts[1])} - ${pos(ts[0])}))`,
                      }}
                      onMouseEnter={() => setHoverFinding(i)}
                      onMouseLeave={() => setHoverFinding(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onSelectFinding(i);
                      }}
                      aria-label={`${CATEGORY_LABEL[f.category]} at ${fmtRange(ts)}`}
                    />
                  );
                })}
                {hoverFinding !== null && lane.items.some((x) => x.i === hoverFinding) && (
                  <div className="tl-tip" style={{ left: pos(p.findings[hoverFinding].timestamp_s![0]), width: 250 }}>
                    <b>{CATEGORY_LABEL[p.findings[hoverFinding].category]}</b>
                    <div className="mono" style={{ fontSize: 10.5, opacity: 0.75, margin: "2px 0 4px" }}>
                      {fmtRange(p.findings[hoverFinding].timestamp_s!)}
                    </div>
                    <span style={{ opacity: 0.9 }}>“{truncate(p.findings[hoverFinding].claim, 110)}”</span>
                  </div>
                )}
              </div>
            ))}
            <div className="tl-playhead" style={{ left: pos(p.currentTime), top: AXIS_H - 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const AXIS_H = 18;
const FRAMES_H = 20;
const BAR_H = 12;
const BAR_GAP = 3;
const LANE_PAD = 4;
const laneHeight = (rows: number) => LANE_PAD * 2 + rows * BAR_H + (rows - 1) * BAR_GAP;

/** Greedy interval packing so overlapping findings in one channel stack instead of hiding each other. */
function pack(findings: Finding[], channel: Channel) {
  const items = findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.timestamp_s && f.evidence_channel === channel)
    .sort((a, b) => a.f.timestamp_s![0] - b.f.timestamp_s![0]);
  const rowEnds: number[] = [];
  const placed = items.map(({ f, i }) => {
    const [s, e] = f.timestamp_s!;
    let row = rowEnds.findIndex((end) => end <= s);
    if (row < 0) {
      row = rowEnds.length;
      rowEnds.push(e);
    } else rowEnds[row] = e;
    return { i, row };
  });
  return { channel, items: placed, rows: Math.max(1, rowEnds.length) };
}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
