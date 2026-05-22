import type { FC, ReactNode } from 'react';
import { useId } from 'react';

interface TooltipProps {
  children: ReactNode;
  /** Accessible label (also shown in tooltip) */
  label: string;
  shortcut?: string;
}

export const Tooltip: FC<TooltipProps> = ({ children, label, shortcut }) => {
  const hint = shortcut ? `${label} (${shortcut})` : label;
  const tooltipId = useId();

  return (
    <span className="group relative inline-flex">
      <span aria-describedby={tooltipId}>{children}</span>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)] px-2 py-1 text-xs text-[var(--sc-text-primary)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {hint}
      </span>
    </span>
  );
};
