import type React from 'react';

// QNBS-v3: C-P1 / CodeAnt — an accessible name is MANDATORY for role="progressbar" (WCAG 2.2 AA
//          4.1.2 name/role/value). The union forces every caller to supply either `aria-label` or
//          `aria-labelledby`, so a progress indicator can never render unnamed for screen readers.
type ProgressProps = {
  value: number; // 0 to 100
  className?: string;
} & ({ 'aria-label': string } | { 'aria-labelledby': string });

export const Progress: React.FC<ProgressProps> = ({ value, className, ...aria }) => {
  const progress = Math.max(0, Math.min(100, value));

  return (
    <div
      // QNBS-v3: role + value + a required name (spread from `aria`) — full name/role/value support.
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...aria}
      className={`h-2 w-full overflow-hidden rounded-full bg-[var(--sc-surface-overlay)] ${className}`}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};
Progress.displayName = 'Progress';
