import type { FC, ReactNode } from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  hint?: string;
  primaryAction?: { label: string; onClick: () => void; icon?: ReactNode };
  secondaryAction?: { label: string; onClick: () => void };
  /** compact reduces vertical padding — for panel-embedded empties */
  compact?: boolean;
}

export const EmptyState: FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  hint,
  primaryAction,
  secondaryAction,
  compact = false,
}) => (
  <div
    role="status"
    className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--sc-border-subtle)] bg-[var(--glass-bg)] px-6 text-center ${compact ? 'py-6' : 'py-12'}`}
  >
    {icon ? (
      <div className={`text-[var(--sc-text-muted)] ${compact ? 'mb-3' : 'mb-4'}`}>{icon}</div>
    ) : null}
    <h3
      className={`font-semibold text-[var(--sc-text-primary)] ${compact ? 'text-base' : 'text-lg'}`}
    >
      {title}
    </h3>
    {description ? (
      <p className="mt-2 max-w-md text-sm text-[var(--sc-text-secondary)]">{description}</p>
    ) : null}
    {hint ? <p className="mt-1.5 max-w-sm text-xs text-[var(--sc-text-muted)]">{hint}</p> : null}
    {(primaryAction ?? secondaryAction) ? (
      <div
        className={`flex flex-wrap items-center justify-center gap-3 ${compact ? 'mt-4' : 'mt-6'}`}
      >
        {primaryAction ? (
          <Button type="button" onClick={primaryAction.onClick} className="flex items-center gap-2">
            {primaryAction.icon ? <span className="w-4 h-4">{primaryAction.icon}</span> : null}
            {primaryAction.label}
          </Button>
        ) : null}
        {secondaryAction ? (
          <Button type="button" variant="secondary" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        ) : null}
      </div>
    ) : null}
  </div>
);
EmptyState.displayName = 'EmptyState';
