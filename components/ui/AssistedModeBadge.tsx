// QNBS-v3: Reusable "Assisted (offline)" indicator for the heuristic-fallback foundation. Presentational
// — features pass the current fallback event (from useHeuristicFallback); renders nothing when null.
import type { FC } from 'react';
import React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import type { HeuristicFallbackEvent } from '../../services/ai/heuristicFallback';
import { Badge } from './Badge';

export const AssistedModeBadge: FC<{
  event: HeuristicFallbackEvent | null;
  className?: string;
}> = React.memo(({ event, className }) => {
  const { t } = useTranslation();
  if (!event) return null;
  return (
    <Badge
      variant="beta"
      srLabel={t('assisted.badge.srLabel')}
      {...(className ? { className } : {})}
    >
      {t('assisted.badge.label')}
    </Badge>
  );
});
AssistedModeBadge.displayName = 'AssistedModeBadge';
