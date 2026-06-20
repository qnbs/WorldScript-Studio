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
      {/* QNBS-v3: reveal on group-focus-WITHIN, not group-focus-visible. The .group wrapper is a
          non-focusable <span>, so focus lands on a focusable child (e.g. a button), which never
          puts :focus-visible on the wrapper itself — group-focus-visible would leave the tooltip
          invisible to keyboard users. focus-within matches when any descendant holds focus. */}
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)] px-2 py-1 text-xs text-[var(--sc-text-primary)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {hint}
      </span>
    </span>
  );
};
Tooltip.displayName = 'Tooltip';
