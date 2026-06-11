/**
 * InlineAnnotationLayer — shows a compact insight badge inside the manuscript editor area
 * when there are heuristic findings relevant to the active chapter title.
 * QNBS-v3: position:absolute overlay, never modifies editor DOM. Gated by enableGlobalCopilot.
 * Clicking the badge opens the Copilot and expands the insight section.
 */

import type { FC } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useTransientUiStore } from '../../app/transientUiStore';
import { copilotActions } from '../../features/copilot/copilotSlice';
import { selectEnableGlobalCopilot } from '../../features/featureFlags/featureFlagsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import type { HeuristicFinding } from '../../services/copilot/heuristicEngine';

interface InlineAnnotationLayerProps {
  sectionTitle: string;
}

// QNBS-v3: match findings whose params include the section title so only relevant
// insights are surfaced in the editor rather than all project-level findings.
function findingsForSection(
  findings: HeuristicFinding[],
  sectionTitle: string,
): HeuristicFinding[] {
  if (!sectionTitle) return [];
  const titleLC = sectionTitle.toLowerCase();
  return findings.filter((f) => {
    const vals = Object.values(f.params);
    return vals.some((v) => String(v).toLowerCase() === titleLC);
  });
}

function severityColor(severity: HeuristicFinding['severity']): string {
  switch (severity) {
    case 'error':
      return 'bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)] border-[var(--sc-danger-border)]';
    case 'warning':
      return 'bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]';
    default:
      return 'bg-[var(--sc-info-bg)] text-[var(--sc-info-fg)]';
  }
}

export const InlineAnnotationLayer: FC<InlineAnnotationLayerProps> = ({ sectionTitle }) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const enableCopilot = useAppSelector(selectEnableGlobalCopilot);
  const insights = useTransientUiStore((s) => s.copilotInsights);
  const insightStatus = useTransientUiStore((s) => s.copilotInsightStatus);
  const setCopilotInsightExpanded = useTransientUiStore((s) => s.setCopilotInsightExpanded);

  if (!enableCopilot || insightStatus === 'running') return null;

  const relevant = findingsForSection(insights, sectionTitle);
  if (relevant.length === 0) return null;

  const topSeverity = relevant.some((f) => f.severity === 'warning')
    ? 'warning'
    : relevant.some((f) => f.severity === 'error')
      ? 'error'
      : 'info';

  const handleClick = () => {
    // QNBS-v3: CodeAnt — force-expand InsightSection so the user immediately sees the findings
    setCopilotInsightExpanded(true);
    dispatch(copilotActions.setOpen(true));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t('copilot.annotationCount', { count: relevant.length })}
      className={`absolute bottom-2 end-2 z-10 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] ${severityColor(topSeverity)}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {t('copilot.annotationCount', { count: relevant.length })}
    </button>
  );
};
