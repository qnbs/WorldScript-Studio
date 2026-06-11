/**
 * HeuristicsModeToggle — ARIA switch that enables "Heuristics Only" (no AI) mode in the Copilot.
 * QNBS-v3: When on, the Copilot skips all AI calls and responds with heuristic analysis only,
 * providing maximum privacy and offline capability.
 */

import type { FC } from 'react';
import type { UseGlobalCopilotReturn } from '../../hooks/useGlobalCopilot';

interface HeuristicsModeToggleProps {
  heuristicsOnly: boolean;
  onToggle: () => void;
  t: UseGlobalCopilotReturn['t'];
}

export const HeuristicsModeToggle: FC<HeuristicsModeToggleProps> = ({
  heuristicsOnly,
  onToggle,
  t,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={heuristicsOnly}
      aria-label={t('copilot.heuristicsOnlyLabel')}
      onClick={onToggle}
      title={t('copilot.heuristicsOnlyLabel')}
      className={`flex items-center gap-1 rounded-sc-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] ${
        heuristicsOnly
          ? 'bg-[var(--sc-info-bg)] text-[var(--sc-info-fg)]'
          : 'text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-raised)]'
      }`}
    >
      {/* Offline/shield icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <span>{t('copilot.heuristicsOnly')}</span>
    </button>
  );
};
