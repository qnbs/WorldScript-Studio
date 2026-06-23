import type { FC } from 'react';

// QNBS-v3: PR5 — decorative microphone-level meter (5 bars). Driven by useMicLevel's 0–1 value.
// aria-hidden: the meaningful state (listening/confidence/transcript) is conveyed by adjacent text.
const METER_BARS = [
  { id: 'b1', h: 30 },
  { id: 'b2', h: 47 },
  { id: 'b3', h: 64 },
  { id: 'b4', h: 81 },
  { id: 'b5', h: 98 },
];

export const VoiceLevelMeter: FC<{ level: number }> = ({ level }) => {
  const clamped = Math.min(1, Math.max(0, level));
  const filled = Math.round(clamped * METER_BARS.length);
  return (
    <span
      className="inline-flex items-end gap-0.5 h-3"
      aria-hidden="true"
      data-testid="voice-level-meter"
    >
      {METER_BARS.map((bar, i) => (
        <span
          key={bar.id}
          className={`w-0.5 rounded-sm transition-[background-color] ${i < filled ? 'bg-[var(--sc-accent)]' : 'bg-[var(--sc-border-subtle)]'}`}
          style={{ height: `${bar.h}%` }}
        />
      ))}
    </span>
  );
};
