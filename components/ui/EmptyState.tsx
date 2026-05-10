import type { FC, ReactNode } from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export const EmptyState: FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  primaryAction,
  secondaryAction,
}) => (
  <div
    role="status"
    className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--glass-bg)] px-6 py-12 text-center"
  >
    {icon ? <div className="mb-4 text-[var(--foreground-muted)]">{icon}</div> : null}
    <h3 className="text-lg font-semibold text-[var(--foreground-primary)]">{title}</h3>
    {description ? (
      <p className="mt-2 max-w-md text-sm text-[var(--foreground-secondary)]">{description}</p>
    ) : null}
    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
      {primaryAction ? (
        <Button type="button" onClick={primaryAction.onClick}>
          {primaryAction.label}
        </Button>
      ) : null}
      {secondaryAction ? (
        <Button type="button" variant="secondary" onClick={secondaryAction.onClick}>
          {secondaryAction.label}
        </Button>
      ) : null}
    </div>
  </div>
);
