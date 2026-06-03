import type { FC } from 'react';

// QNBS-v3: Small SVG completeness ring for roster cards (Characters / World). Decorative arc is
// aria-hidden; an sr-only label carries the value for assistive tech. Band-colored via state tokens.
interface CompletenessRingProps {
  /** 0–100. */
  value: number;
  /** Accessible label, e.g. "Profile 60% complete". */
  label: string;
  size?: number;
}

export const CompletenessRing: FC<CompletenessRingProps> = ({ value, label, size = 36 }) => {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color =
    clamped >= 75
      ? 'var(--sc-success-fg)'
      : clamped >= 40
        ? 'var(--sc-warning-fg)'
        : 'var(--sc-danger-fg)';

  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      title={label}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--sc-surface-overlay)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-[0.6rem] font-bold tabular-nums text-[var(--sc-text-primary)]">
        {clamped}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
};
