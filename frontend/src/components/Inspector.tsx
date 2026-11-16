import { useEffect, useId, useRef } from "react";

/** The Inspector: a thread-wound puppet whose face carries the state of the review.
 *  Its pupils follow the pointer; while a review runs it reads; the verdict sets its expression. */

export type Mood = "idle" | "reading" | "non_compliant" | "needs_review" | "compliant";

const MOOD_LABEL: Record<Mood, string> = {
  idle: "The inspector is waiting",
  reading: "The inspector is reading the ad",
  non_compliant: "The inspector found problems",
  needs_review: "The inspector is unsure",
  compliant: "The inspector is satisfied",
};

const HEAD = "M60 12C88 12 100 34 98 56C96 78 80 98 60 98C40 98 24 78 22 56C20 34 32 12 60 12Z";
const NECK = "M52 90L68 90L70 118L50 118Z";
const JACKET = "M4 140C6 119 30 110 50 113L60 131L70 113C90 110 114 119 116 140Z";

const BROWS: Record<Mood, [string, string]> = {
  idle: ["M31 38Q43 32 54 38", "M66 38Q77 32 89 38"],
  reading: ["M31 36Q44 35 54 40", "M66 40Q76 35 89 36"],
  non_compliant: ["M29 42Q40 30 54 34", "M66 34Q80 30 91 42"],
  needs_review: ["M31 39L54 40", "M66 33Q78 24 90 32"],
  compliant: ["M31 36Q43 29 54 35", "M66 35Q77 29 89 36"],
};

const MOUTH: Record<Mood, string> = {
  idle: "M52 82Q60 84.5 68 82",
  reading: "M55 83Q60 85.5 65 83",
  non_compliant: "M51 86Q60 79 69 86",
  needs_review: "M52 84L68 82",
  compliant: "M48 80Q60 90 72 80",
};

const STITCHES: [number, number][] = [
  [52, 82.8],
  [56, 84.4],
  [60, 85],
  [64, 84.4],
  [68, 82.8],
];

const HAIR: [number, number, number][] = [
  [27, 35, 7],
  [34, 23, 11],
  [46, 14, 12],
  [60, 10, 12.5],
  [74, 13, 12],
  [86, 22, 11],
  [93, 34, 7],
  [40, 7, 5],
  [67, 3, 5.5],
  [83, 9, 5],
];

const WINDS = Array.from({ length: 37 }, (_, i) => 13 + i * 2.35);

// One pointer listener for every puppet on the page.
type Sub = (x: number, y: number) => void;
const subs = new Set<Sub>();
let raf = 0;
let px = 0;
let py = 0;
const onMove = (e: PointerEvent) => {
  px = e.clientX;
  py = e.clientY;
  if (!raf)
    raf = requestAnimationFrame(() => {
      raf = 0;
      subs.forEach((f) => f(px, py));
    });
};
function subscribe(fn: Sub) {
  if (!subs.size) addEventListener("pointermove", onMove, { passive: true });
  subs.add(fn);
  return () => {
    subs.delete(fn);
    if (!subs.size) removeEventListener("pointermove", onMove);
  };
}

interface Props {
  mood?: Mood;
  size?: number; // rendered width in px
  bust?: boolean; // show the striped neck and red jacket
  className?: string;
}

export function Inspector({ mood = "idle", size = 96, bust = false, className }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    const el = ref.current;
    if (!el || mood === "reading") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return subscribe((x, y) => {
      const r = el.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height * 0.42);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 220) * 4.2;
      el.style.setProperty("--gx", ((dx / d) * reach).toFixed(2));
      el.style.setProperty("--gy", ((dy / d) * reach).toFixed(2));
    });
  }, [mood]);

  const [vx, vy, vw, vh] = bust ? [2, -6, 116, 144] : [14, -6, 92, 116];
  const id = (s: string) => `${uid}-${s}`;
  const url = (s: string) => `url(#${id(s)})`;

  return (
    <svg
      ref={ref}
      className={`insp m-${mood}${className ? ` ${className}` : ""}`}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      width={size}
      height={(size * vh) / vw}
      role="img"
      aria-label={MOOD_LABEL[mood]}
    >
      <defs>
        <radialGradient id={id("skin")} cx="38%" cy="26%" r="82%">
          <stop offset="0" stopColor="#faf5e9" />
          <stop offset=".58" stopColor="#ebe3d0" />
          <stop offset="1" stopColor="#c9bda3" />
        </radialGradient>
        <linearGradient id={id("coat")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ad3027" />
          <stop offset="1" stopColor="#7d1e19" />
        </linearGradient>
        <clipPath id={id("head")}>
          <path d={HEAD} />
        </clipPath>
        <clipPath id={id("neck")}>
          <path d={NECK} />
        </clipPath>
        <clipPath id={id("coatclip")}>
          <path d={JACKET} />
        </clipPath>
        <clipPath id={id("eyeL")}>
          <circle cx="43" cy="55" r="10.2" />
        </clipPath>
        <clipPath id={id("eyeR")}>
          <circle cx="77" cy="55" r="10.2" />
        </clipPath>
        <filter id={id("fuzz")} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency=".11" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id={id("wob")} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="8" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id={id("soft")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* neck: red thread wrapped over bone, like the tree trunk */}
      <g filter={url("wob")}>
        <path d={NECK} fill="#ebe3d0" />
        <g clipPath={url("neck")}>
          {[93, 101.5, 110].map((y) => (
            <path key={y} d={`M48 ${y}L72 ${y - 1.4}L72 ${y + 3.2}L48 ${y + 4.6}Z`} fill="#a32a22" />
          ))}
          <path d="M50 90L54 118" stroke="#2a211d" strokeOpacity=".14" strokeWidth="5" />
        </g>
      </g>

      {bust && (
        <g filter={url("wob")}>
          <path d={JACKET} fill={url("coat")} stroke="#641611" strokeWidth="1" />
          <g clipPath={url("coatclip")} stroke="#641611" strokeOpacity=".4" strokeWidth=".5" fill="none">
            {Array.from({ length: 14 }, (_, i) => (
              <path key={i} d={`M0 ${113 + i * 2.2}Q60 ${119 + i * 2.2} 120 ${113 + i * 2.2}`} />
            ))}
          </g>
          <path d="M50 113L60 131L44 124Z" fill="#e9e1cf" stroke="#b3a68c" strokeWidth=".7" />
          <path d="M70 113L60 131L76 124Z" fill="#ded5c0" stroke="#b3a68c" strokeWidth=".7" />
          <path d="M44 124L38 140M76 124L82 140" stroke="#641611" strokeWidth="1.3" fill="none" />
          <circle cx="60" cy="137" r="1.7" fill="#2a211d" />
        </g>
      )}

      {/* head */}
      <g filter={url("wob")}>
        <path d={HEAD} fill={url("skin")} stroke="#b3a68c" strokeWidth=".8" />
        <g clipPath={url("head")}>
          <g stroke="#9d8f73" strokeOpacity=".42" strokeWidth=".45" fill="none">
            {WINDS.map((y) => (
              <path key={y} d={`M18 ${y}Q60 ${y + 2.4} 102 ${y}`} />
            ))}
          </g>
          <g className="insp-rims" filter={url("soft")}>
            <ellipse cx="43" cy="56" rx="16.5" ry="15.5" />
            <ellipse cx="77" cy="56" rx="16.5" ry="15.5" />
          </g>
        </g>
      </g>

      {/* hair: ragged burlap mesh */}
      <g filter={url("fuzz")}>
        {HAIR.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#3a2c25" />
        ))}
        <g stroke="#6d584a" strokeWidth=".9" fill="none" strokeOpacity=".8">
          <path d="M26 30Q36 12 50 12Q62 2 74 10Q88 14 93 30" />
          <path d="M32 26Q44 20 52 8M58 18Q66 8 80 16M70 20Q84 22 90 28M38 14Q48 24 60 14" />
        </g>
      </g>

      {/* eyes */}
      <circle cx="43" cy="55" r="10.4" fill="#e9e2d1" stroke="#2a211d" strokeWidth="1.5" />
      <circle cx="77" cy="55" r="10.4" fill="#e9e2d1" stroke="#2a211d" strokeWidth="1.5" />
      {(
        [
          ["eyeL", 43],
          ["eyeR", 77],
        ] as const
      ).map(([clip, cx]) => (
        <g key={clip} clipPath={url(clip)}>
          <g className="insp-pupil">
            <circle cx={cx} cy="55" r="5.5" fill="#32241d" />
            <circle cx={cx} cy="55" r="3.5" fill="none" stroke="#644e40" strokeWidth=".7" />
            <circle cx={cx} cy="55" r="1.6" fill="none" stroke="#644e40" strokeWidth=".6" />
          </g>
          <rect className="insp-lid" x={cx - 11} y="44" width="22" height="22" />
        </g>
      ))}

      <path className="insp-brow" d={BROWS[mood][0]} />
      <path className="insp-brow" d={BROWS[mood][1]} />

      <ellipse cx="60" cy="70" rx="3.2" ry="2.3" fill="#cdb79f" />
      <path d="M57.4 71.4Q60 73.4 62.6 71.4" stroke="#a48d74" strokeWidth=".8" fill="none" strokeLinecap="round" />

      <path className="insp-mouth" d={MOUTH[mood]} />
      {mood === "compliant" &&
        STITCHES.map(([x, y]) => (
          <path key={x} d={`M${x} ${y - 2.3}L${x} ${y + 2.3}`} stroke="#2a211d" strokeWidth="1" strokeLinecap="round" />
        ))}
    </svg>
  );
}
