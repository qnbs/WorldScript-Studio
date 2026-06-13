/**
 * InsightSection — collapsible section showing up to 5 proactive heuristic findings.
 * Collapsed by default with a count badge; expands on click.
 * QNBS-v3: Uses useAnnounce for live-region notification when new insights arrive.
 */

import { type FC, useEffect, useRef, useState } from 'react';
import { useTransientUiStore } from '../../app/transientUiStore';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import type { UseGlobalCopilotReturn } from '../../hooks/useGlobalCopilot';
import type { HeuristicFinding } from '../../services/copilot/heuristicEngine';
import type { View } from '../../types';
import { Icon } from '../ui/Icon';
import { InsightCard } from './InsightCard';

interface InsightSectionProps {
  insights: HeuristicFinding[];
  // QNBS-v3: heuristicsOnly threaded through so InsightCard can hide "Tell me more"
  copilot: Pick<UseGlobalCopilotReturn, 't' | 'sendMessage' | 'heuristicsOnly'>;
  onNavigate?: (view: View) => void;
}

const MAX_VISIBLE = 5;

export const InsightSection: FC<InsightSectionProps> = ({ insights, copilot, onNavigate }) => {
  const { t } = copilot;
  const [expanded, setExpanded] = useState(false);
  const announce = useAnnounce();
  const prevCountRef = useRef(0);
  const forceExpand = useTransientUiStore((s) => s.copilotInsightExpanded);
  const setCopilotInsightExpanded = useTransientUiStore((s) => s.setCopilotInsightExpanded);

  // QNBS-v3: CodeAnt — badge click in InlineAnnotationLayer sets this; consume once then reset.
  useEffect(() => {
    if (forceExpand) {
      setExpanded(true);
      setCopilotInsightExpanded(false);
    }
  }, [forceExpand, setCopilotInsightExpanded]);

  // QNBS-v3: Announce new insights politely so screen-reader users are notified.
  useEffect(() => {
    const count = insights.length;
    if (count > prevCountRef.current && count > 0) {
      announce(t('copilot.insightSection', { count }), 'polite');
    }
    prevCountRef.current = count;
  }, [insights.length, t, announce]);

  if (insights.length === 0) return null;

  const visible = insights.slice(0, MAX_VISIBLE);
  const sectionId = 'copilot-insight-section';

  return (
    <div className="border-b border-[var(--sc-border-subtle)] px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={sectionId}
        className="flex w-full items-center justify-between gap-1 text-xs font-medium text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
      >
        <span>{t('copilot.insightSection', { count: insights.length })}</span>
        <Icon
          name="chevron-down"
          size="sm"
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div id={sectionId} className="mt-2 flex flex-col gap-2">
          {visible.map((finding) => (
            <InsightCard
              key={finding.id}
              finding={finding}
              copilot={copilot}
              // QNBS-v3: exactOptionalPropertyTypes — only spread when defined.
              {...(onNavigate ? { onNavigate } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
};
