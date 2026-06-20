// QNBS-v3: one-time explainer shown on first activation of a Writer mode (Flow/Focus/ProForge).
// Persisted dismissal lives in useFirstUseFlag. Not a hover Tooltip — it must stay visible until
// the user explicitly closes it. Reuses accent/surface tokens (no `dark:` prefix).
import type { FC } from 'react';

export interface WriterModeCoachmarkProps {
  title: string;
  body: string;
  dismissLabel: string;
  onDismiss: () => void;
}

export const WriterModeCoachmark: FC<WriterModeCoachmarkProps> = ({
  title,
  body,
  dismissLabel,
  onDismiss,
}) => (
  <div
    role="note"
    className="flex items-start gap-3 rounded-[var(--radius-sc-lg)] border border-[var(--sc-accent)]/30 bg-[var(--sc-accent)]/10 px-3 py-2"
  >
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-[var(--sc-text-primary)]">{title}</p>
      <p className="text-xs text-[var(--sc-text-secondary)] mt-0.5">{body}</p>
    </div>
    <button
      type="button"
      onClick={onDismiss}
      className="text-xs min-h-[44px] sm:min-h-0 px-3 sm:px-2 py-2 sm:py-1 rounded border border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] transition-colors shrink-0 touch-manipulation"
    >
      {dismissLabel}
    </button>
  </div>
);
WriterModeCoachmark.displayName = 'WriterModeCoachmark';
