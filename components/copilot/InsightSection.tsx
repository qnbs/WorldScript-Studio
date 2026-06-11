/**
 * InsightSection — collapsible section showing up to 5 proactive heuristic findings.
 * Collapsed by default with a count badge; expands on click.
 * QNBS-v3: Uses useAnnounce for live-region notification when new insights arrive.
 */

import { type FC, useEffect, useRef, useState } from 'react';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import type { UseGlobalCopilotReturn } from '../../hooks/useGlobalCopilot';
import type { HeuristicFinding } from '../../services/copilot/heuristicEngine';
import type { View } from '../../types';
import { InsightCard } from './InsightCard';

interface InsightSectionProps {
  insights: HeuristicFinding[];
  copilot: Pick<UseGlobalCopilotReturn, 't' | 'sendMessage'>;
  onNavigate?: (view: View) => void;
}

const MAX_VISIBLE = 5;

export const InsightSection: FC<InsightSectionProps> = ({ insights, copilot, onNavigate }) => {
  const { t } = copilot;
  const [expanded, setExpanded] = useState(false);
  const announce = useAnnounce();
  const prevCountRef = useRef(0);

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
        className="flex w-full items-center justify-between gap-1 text-xs font-medium text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
      >
        <span>{t('copilot.insightSection', { count: insights.length })}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
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
