/*
  L10 · Radar Sweep — wordmark + radar-sweep mark.
  Adapted from the Track Digger v2 design (project/extras.jsx → MarkSweep).
  The accent sweep + center cap use a lavender → light-violet gradient,
  matching the C9 Sand & Lavender palette (--td-accent / --td-accent-2).
*/
import { useId } from "react";

export function Logo({
  size = 36,
  wordmarkSize,
  showWordmark = true,
  className = "",
}: {
  size?: number;
  wordmarkSize?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  const resolvedWordmark = wordmarkSize ?? Math.round(size * 0.72);
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <RadarSweepMark size={size} />
      {showWordmark && (
        <span
          className="inline-block font-display font-medium text-td-fg leading-none whitespace-nowrap"
          style={{
            fontSize: `clamp(16px, 4.4vw, ${resolvedWordmark}px)`,
            letterSpacing: "-0.02em",
          }}
        >
          Track Digger
        </span>
      )}
    </span>
  );
}

export function RadarSweepMark({
  size = 36,
  gradientId,
  glow = true,
}: {
  size?: number;
  gradientId?: string;
  glow?: boolean;
}) {
  // Auto-generate a per-instance id when none is passed. Two <Logo />
  // instances rendered together (e.g. mobile + desktop variants in the nav)
  // would otherwise share the same gradient id, which makes the second
  // SVG's `url(#td-radar-grad)` references resolve to a sibling that may
  // be inside a `display:none` container — silently dropping the sweep
  // wedge and the center cap.
  const reactId = useId();
  const id = gradientId ?? `td-radar-${reactId.replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 46 46"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d8c8ff" />
          <stop offset="55%" stopColor="#b9a3e8" />
          <stop offset="100%" stopColor="#8a73c4" />
        </linearGradient>
        {glow && (
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#b9a3e8" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#b9a3e8" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {glow && <circle cx="23" cy="23" r="22" fill={`url(#${id}-glow)`} />}

      {/* Vinyl base */}
      <circle cx="23" cy="23" r="20" fill="#0e0c10" />

      {/* Concentric grooves */}
      <circle cx="23" cy="23" r="20" fill="none" stroke="#efeaf3" strokeOpacity="0.30" strokeWidth="1" />
      <circle cx="23" cy="23" r="15.5" fill="none" stroke="#efeaf3" strokeOpacity="0.22" strokeWidth="1" />
      <circle cx="23" cy="23" r="11" fill="none" stroke="#efeaf3" strokeOpacity="0.16" strokeWidth="1" />

      {/* Radar sweep wedge — lavender gradient */}
      <path
        d="M23 23 L23 3 A20 20 0 0 1 38 11 Z"
        fill={`url(#${id})`}
        fillOpacity="0.85"
      />

      {/* Center label cap */}
      <circle cx="23" cy="23" r="6.5" fill={`url(#${id})`} />
      <circle cx="23" cy="23" r="1.2" fill="#0e0c10" />
    </svg>
  );
}
