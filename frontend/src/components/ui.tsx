import type { ReactNode } from "react";
import { CHANNEL_LABEL, SEVERITY_LABEL, VERDICT_LABEL } from "../lib";
import type { Channel, Severity, Verdict } from "../types";

type IconProps = { size?: number; className?: string };

const svg = (path: ReactNode, { size = 14, className }: IconProps, sw = 2) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {path}
  </svg>
);

export const IconCheck = (p: IconProps) => svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, p, 2.6);
export const IconX = (p: IconProps) => svg(<path d="M6 6l12 12M18 6L6 18" />, p, 2.6);
export const IconDash = (p: IconProps) => svg(<path d="M7 12h10" />, p, 2.4);
export const IconPlus = (p: IconProps) => svg(<path d="M12 5v14M5 12h14" />, p, 2.2);
export const IconArrow = (p: IconProps) => svg(<path d="M5 12h14M13 6l6 6-6 6" />, p, 2);
export const IconPlay = (p: IconProps) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" aria-hidden="true" className={p.className}>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </svg>
);
export const IconPause = (p: IconProps) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" aria-hidden="true" className={p.className}>
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
  </svg>
);
export const IconAlert = (p: IconProps) =>
  svg(
    <>
      <path d="M12 3.5L2.5 20h19z" />
      <path d="M12 10v4.5M12 17.3v.2" />
    </>,
    p,
    2,
  );
export const IconExternal = (p: IconProps) => svg(<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" />, p, 2);
export const IconChevron = (p: IconProps) => svg(<path d="M9 6l6 6-6 6" />, p, 2.2);
export const IconShield = (p: IconProps) =>
  svg(<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" />, p, 2);

const VERDICT_ICON: Record<Verdict, (p: IconProps) => ReactNode> = {
  non_compliant: IconX,
  needs_review: IconAlert,
  compliant: IconCheck,
};

export function VerdictBadge({ verdict, size = "sm" }: { verdict: Verdict; size?: "sm" | "lg" }) {
  const Icon = VERDICT_ICON[verdict];
  return (
    <span className={`verdict ${size} v-${verdict}`}>
      {size === "lg" && <Icon size={15} />}
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span className={`tag sev sev-${severity}`}>
      <span className={`sev-dot sev-${severity}`} />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function ChannelTag({ channel }: { channel: Channel }) {
  return <span className="tag">{CHANNEL_LABEL[channel]}</span>;
}
