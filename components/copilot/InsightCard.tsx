/**
 * InsightCard — displays a single proactive heuristic finding with "Tell me more" and
 * "Open view" actions. Used inside InsightSection inside CopilotPanel.
 * QNBS-v3: Fully i18n-aware; severity icon uses design-system state tokens.
 */

import type { FC } from 'react';
import type { UseGlobalCopilotReturn } from '../../hooks/useGlobalCopilot';
import type { HeuristicFinding, HeuristicSeverity } from '../../services/copilot/heuristicEngine';
import type { View } from '../../types';

interface InsightCardProps {
  finding: HeuristicFinding;
  copilot: Pick<UseGlobalCopilotReturn, 't' | 'sendMessage'>;
  onNavigate?: (view: View) => void;
}

function severityClass(severity: HeuristicSeverity): string {
  switch (severity) {
    case 'error':
      return 'text-[var(--sc-danger-fg)] bg-[var(--sc-danger-bg)]';
    case 'warning':
      return 'text-[var(--sc-warning-fg)] bg-[var(--sc-warning-bg)]';
    default:
      return 'text-[var(--sc-info-fg)] bg-[var(--sc-info-bg)]';
  }
}

function SeverityDot({ severity }: { severity: HeuristicSeverity }) {
  const cls = (() => {
    switch (severity) {
      case 'error':
        return 'bg-[var(--sc-danger-fg)]';
      case 'warning':
        return 'bg-[var(--sc-warning-fg)]';
      default:
        return 'bg-[var(--sc-info-fg)]';
    }
  })();
  return (
    <span aria-hidden="true" className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />
  );
}

export const InsightCard: FC<InsightCardProps> = ({ finding, copilot, onNavigate }) => {
  const { t, sendMessage } = copilot;

  const title = t(finding.titleKey, finding.params);
  const desc = t(finding.descriptionKey, finding.params);
  const bgCls = severityClass(finding.severity);

  const handleTellMore = () => {
    const prompt = `${title}: ${desc} ${t('copilot.insightTellMore')}`;
    sendMessage(prompt);
  };

  const handleOpenView = () => {
    onNavigate?.(finding.targetView);
  };

  return (
    <div
      className={`rounded-sc-lg border border-[var(--sc-border-subtle)] p-2.5 text-xs ${bgCls.split(' ')[1] ?? ''}`}
    >
      <div className="flex items-start gap-2">
        <SeverityDot severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--sc-text-primary)]">{title}</p>
          <p className="mt-0.5 text-[var(--sc-text-secondary)]">{desc}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={handleTellMore}
              className="rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] px-2 py-0.5 text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
            >
              {t('copilot.insightTellMore')}
            </button>
            {finding.actionable && onNavigate && (
              <button
                type="button"
                onClick={handleOpenView}
                className="rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] px-2 py-0.5 text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
              >
                {t('copilot.insightOpenView', { view: finding.targetView })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
