/**
 * Pipeline Review Panel — Human-in-the-Loop diff view and approval interface.
 * QNBS-v3: P-5 redesign — severity-grouped layout with Critical Actions summary card
 * and Quick Accept High-Confidence to reduce decision fatigue on large review sets.
 */

import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useTransientUiStore } from '../../app/transientUiStore';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import { useProForgeViewContext } from '../../contexts/ProForgeViewContext';
import { copilotActions } from '../../features/copilot/copilotSlice';
import { selectEnableGlobalCopilot } from '../../features/featureFlags/featureFlagsSlice';
import { proForgeActions } from '../../features/proForge/proForgeSlice';
import type { ReviewItem, ReviewItemStatus } from '../../features/proForge/types';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../ui/Icon';

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  critical: <Icon name="error" size="sm" aria-hidden="true" data-testid="severity-icon-critical" />,
  warning: <Icon name="warning" size="sm" aria-hidden="true" data-testid="severity-icon-warning" />,
  info: <Icon name="info" size="sm" aria-hidden="true" data-testid="severity-icon-info" />,
};

const SEVERITY_GROUPS = [
  {
    key: 'critical' as const,
    labelKey: 'proforge.review.group.critical',
    headerClass: 'text-[var(--sc-error)] border-[var(--sc-error-muted)]',
    badgeClass: 'bg-[var(--sc-error-muted)] text-[var(--sc-error)]',
  },
  {
    key: 'warning' as const,
    labelKey: 'proforge.review.group.warning',
    headerClass: 'text-[var(--sc-warning,#d97706)] border-[var(--sc-warning-muted,#fef3c7)]',
    badgeClass: 'bg-[var(--sc-warning-muted,#fef3c7)] text-[var(--sc-warning,#d97706)]',
  },
  {
    key: 'info' as const,
    labelKey: 'proforge.review.group.info',
    headerClass: 'text-[var(--sc-accent)] border-[var(--sc-accent-muted,#eff6ff)]',
    badgeClass: 'bg-[var(--sc-accent-muted,#eff6ff)] text-[var(--sc-accent)]',
  },
] as const;

export const PipelineReviewPanel: React.FC = () => {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const {
    currentRun,
    activeStageResult,
    currentStageReviewItems,
    submitReview,
    skipStage,
    setActiveView,
    dispatch,
  } = useProForgeViewContext();

  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  const stage = activeStageResult?.stage;
  // QNBS-v3: Localised stage label; falls back to the raw stage id if no key exists.
  const stageLabel = stage ? t(`proforge.stageName.${stage}`) : '';

  const pendingCount = currentStageReviewItems.filter((i) => i.status === 'pending').length;
  const acceptedCount = currentStageReviewItems.filter((i) => i.status === 'accepted').length;
  const rejectedCount = currentStageReviewItems.filter((i) => i.status === 'rejected').length;

  // Severity-grouped items sorted by confidence descending (used in 'all' view)
  const groupedItems = useMemo(() => {
    const bySeverity = (severity: 'critical' | 'warning' | 'info') =>
      currentStageReviewItems
        .filter((i) => i.severity === severity)
        .sort((a, b) => b.confidence - a.confidence);
    return {
      critical: bySeverity('critical'),
      warning: bySeverity('warning'),
      info: bySeverity('info'),
    };
  }, [currentStageReviewItems]);

  // Flat filtered list for non-'all' filter tabs
  const filteredItems = useMemo(() => {
    if (filter === 'all') return [];
    return currentStageReviewItems.filter((i) => i.status === filter);
  }, [currentStageReviewItems, filter]);

  const criticalPending = groupedItems.critical.filter((i) => i.status === 'pending');
  const topCritical = criticalPending.slice(0, 3);

  const handleItemStatus = useCallback(
    (itemId: string, status: ReviewItemStatus) => {
      if (!stage) return;
      dispatch(proForgeActions.setReviewItemStatus({ stage, itemId, status }));
    },
    [dispatch, stage],
  );

  const handleAcceptAll = useCallback(() => {
    if (!stage) return;
    dispatch(proForgeActions.acceptAllReviewItems({ stage }));
  }, [dispatch, stage]);

  const handleRejectAll = useCallback(() => {
    if (!stage) return;
    dispatch(proForgeActions.rejectAllReviewItems({ stage }));
  }, [dispatch, stage]);

  // QNBS-v3: Accept all critical pending items without touching warnings/suggestions.
  const handleAcceptAllCritical = useCallback(() => {
    if (!stage) return;
    for (const item of criticalPending) {
      dispatch(proForgeActions.setReviewItemStatus({ stage, itemId: item.id, status: 'accepted' }));
    }
  }, [dispatch, stage, criticalPending]);

  // QNBS-v3: One-click accept for safe high-confidence items; critical items require explicit review.
  const handleQuickAcceptHighConfidence = useCallback(() => {
    if (!stage) return;
    const eligible = currentStageReviewItems.filter(
      (i) => i.confidence >= 0.85 && i.severity !== 'critical' && i.status === 'pending',
    );
    for (const item of eligible) {
      dispatch(proForgeActions.setReviewItemStatus({ stage, itemId: item.id, status: 'accepted' }));
    }
  }, [dispatch, stage, currentStageReviewItems]);

  const quickAcceptCount = currentStageReviewItems.filter(
    (i) => i.confidence >= 0.85 && i.severity !== 'critical' && i.status === 'pending',
  ).length;

  const handleSubmit = useCallback(async () => {
    if (!stage) return;
    const items = activeStageResult?.reviewItems ?? [];
    const decisions = items.map((item) => ({ itemId: item.id, status: item.status }));
    // QNBS-v3: Await completion before announcing/navigating — submitReview is async (applies
    // edits + snapshots), so announcing success before it resolves could lie if it rejects.
    await submitReview(stage, decisions);
    // WCAG live-region announce so screen-reader users hear the stage was submitted.
    announce(t('proforge.review.announceSubmitted', { stage: stageLabel }), 'polite');
    setActiveView('dashboard');
  }, [stage, stageLabel, activeStageResult, submitReview, setActiveView, announce, t]);

  const handleSkip = useCallback(() => {
    if (!stage) return;
    skipStage(stage);
    setActiveView('dashboard');
  }, [stage, skipStage, setActiveView]);

  if (!currentRun || !stage) {
    return (
      <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-6 text-center">
        <p className="text-sm text-[var(--sc-text-secondary)]">{t('proforge.review.noItems')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] flex flex-col max-h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--sc-border-subtle)]">
        <div>
          <h3 className="text-sm font-medium">
            {t('proforge.review.heading', { stage: stageLabel })}
          </h3>
          <p className="text-xs text-[var(--sc-text-secondary)] mt-0.5">
            {t('proforge.review.counts', {
              pending: pendingCount,
              accepted: acceptedCount,
              rejected: rejectedCount,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {quickAcceptCount > 0 && (
            <button
              type="button"
              onClick={handleQuickAcceptHighConfidence}
              className="px-2.5 py-1 text-xs rounded-sc-md bg-[var(--sc-accent-muted,#eff6ff)] text-[var(--sc-accent)] hover:opacity-80 transition-opacity"
              title={t('proforge.review.quickAcceptTitle')}
            >
              {t('proforge.review.quickAccept', { count: quickAcceptCount })}
            </button>
          )}
          <button
            type="button"
            onClick={handleAcceptAll}
            className="px-2.5 py-1 text-xs rounded-sc-md bg-[var(--sc-success-muted)] text-[var(--sc-success)] hover:opacity-80 transition-opacity"
          >
            {t('proforge.review.acceptAll')}
          </button>
          <button
            type="button"
            onClick={handleRejectAll}
            className="px-2.5 py-1 text-xs rounded-sc-md bg-[var(--sc-error-muted)] text-[var(--sc-error)] hover:opacity-80 transition-opacity"
          >
            {t('proforge.review.rejectAll')}
          </button>
        </div>
      </div>

      {/* Critical Actions Summary Card */}
      {criticalPending.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-sc-md border border-[var(--sc-error-muted)] bg-[var(--sc-error-muted)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--sc-error)] flex items-center gap-1">
              <Icon name="error" size="sm" aria-hidden="true" />
              {t(
                criticalPending.length === 1
                  ? 'proforge.review.criticalHeadingOne'
                  : 'proforge.review.criticalHeadingOther',
                { count: criticalPending.length },
              )}
            </span>
            <button
              type="button"
              onClick={handleAcceptAllCritical}
              className="px-2 py-0.5 text-xs rounded-sc-sm bg-[var(--sc-error)] text-[var(--sc-text-on-accent)] hover:opacity-80 transition-opacity"
            >
              {t('proforge.review.acceptAllCritical')}
            </button>
          </div>
          {topCritical.map((item) => (
            <div key={item.id} className="text-xs text-[var(--sc-error)] truncate mt-1">
              · {item.description}
            </div>
          ))}
          {criticalPending.length > 3 && (
            <div className="text-xs text-[var(--sc-error)] mt-1 opacity-70">
              {t('proforge.review.moreCritical', { count: criticalPending.length - 3 })}
            </div>
          )}
        </div>
      )}

      {/* Filter Tabs — secondary position */}
      <div className="flex gap-1 px-4 pt-3">
        {(['all', 'pending', 'accepted', 'rejected'] as const).map((f) => {
          const count =
            f === 'all'
              ? currentStageReviewItems.length
              : currentStageReviewItems.filter((i) => i.status === f).length;
          return (
            <button
              type="button"
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`px-2.5 py-1 text-xs rounded-sc-md transition-colors ${
                filter === f
                  ? 'bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)]'
                  : 'bg-[var(--sc-surface-base)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'
              }`}
            >
              {t(`proforge.review.filter.${f}`)} ({count})
            </button>
          );
        })}
      </div>

      {/* Review Items */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filter === 'all' ? (
          // Severity-grouped view
          SEVERITY_GROUPS.map((group) => {
            const items = groupedItems[group.key];
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <div className={`flex items-center gap-2 mb-2 pb-1 border-b ${group.headerClass}`}>
                  <span className="text-xs font-semibold">{t(group.labelKey)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-sc-sm ${group.badgeClass}`}>
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <ReviewItemCard key={item.id} item={item} onStatusChange={handleItemStatus} />
                  ))}
                </div>
              </div>
            );
          })
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-[var(--sc-text-secondary)] text-center py-8">
            {t('proforge.review.noItemsForFilter')}
          </p>
        ) : (
          filteredItems.map((item) => (
            <ReviewItemCard key={item.id} item={item} onStatusChange={handleItemStatus} />
          ))
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--sc-border-subtle)]">
        <button
          type="button"
          onClick={handleSkip}
          className="px-3 py-1.5 text-xs rounded-sc-md text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] transition-colors"
        >
          {t('proforge.review.skipStage')}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={pendingCount > 0}
          className="px-4 py-1.5 text-xs font-medium rounded-sc-md text-[var(--sc-text-on-accent)] disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--sc-accent)' }}
        >
          {pendingCount > 0
            ? t('proforge.review.pendingCount', { count: pendingCount })
            : t('proforge.review.submitContinue')}
        </button>
      </div>
    </div>
  );
};

PipelineReviewPanel.displayName = 'PipelineReviewPanel';

function ReviewItemCard({
  item,
  onStatusChange,
}: {
  item: ReviewItem;
  onStatusChange: (id: string, status: ReviewItemStatus) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isCopilotEnabled = useAppSelector(selectEnableGlobalCopilot);
  const setCopilotDraftMessage = useTransientUiStore((s) => s.setCopilotDraftMessage);
  const [expanded, setExpanded] = useState(false);

  const statusButtons: { status: ReviewItemStatus; labelKey: string; color: string }[] = [
    { status: 'accepted', labelKey: 'proforge.review.accept', color: 'var(--sc-success)' },
    { status: 'rejected', labelKey: 'proforge.review.reject', color: 'var(--sc-error)' },
    { status: 'ignored', labelKey: 'proforge.review.ignore', color: 'var(--sc-text-tertiary)' },
  ];

  return (
    <div
      className={`p-3 rounded-sc-md border transition-colors ${
        item.status === 'accepted'
          ? 'bg-[var(--sc-success-muted)] border-[var(--sc-success-muted)]'
          : item.status === 'rejected'
            ? 'bg-[var(--sc-error-muted)] border-[var(--sc-error-muted)] opacity-60'
            : 'bg-[var(--sc-surface-base)] border-[var(--sc-border-subtle)]'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* QNBS-v3: Emoji is decorative; severity is conveyed to AT via the sr-only text below. */}
        <span className="text-sm mt-0.5" aria-hidden="true">
          {SEVERITY_ICONS[item.severity]}
        </span>
        <span className="sr-only">{t(`proforge.review.severity.${item.severity}`)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-sc-sm bg-[var(--sc-surface-elevated)]">
              {t(`proforge.review.type.${item.type}`)}
            </span>
            {item.sectionTitle && (
              <span className="text-xs text-[var(--sc-text-secondary)] truncate">
                {item.sectionTitle}
              </span>
            )}
            <span className="text-xs text-[var(--sc-text-tertiary)] ml-auto">
              {t('proforge.review.confidence', { percent: Math.round(item.confidence * 100) })}
            </span>
          </div>
          <p className="text-sm mt-1.5">{item.description}</p>

          {item.original && item.proposed && expanded && (
            <div className="mt-2 space-y-1.5 text-xs">
              <div className="p-2 rounded-sc-sm bg-[var(--sc-error-muted)] text-[var(--sc-error)]">
                <span className="font-medium">{t('proforge.review.original')}</span> {item.original}
              </div>
              <div className="p-2 rounded-sc-sm bg-[var(--sc-success-muted)] text-[var(--sc-success)]">
                <span className="font-medium">{t('proforge.review.proposed')}</span> {item.proposed}
              </div>
            </div>
          )}

          {item.rationale && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="text-xs text-[var(--sc-accent)] mt-1 hover:underline"
            >
              {expanded ? t('proforge.review.showLess') : t('proforge.review.showDetails')}
            </button>
          )}

          {/* Status Actions */}
          <div className="flex flex-wrap gap-2 mt-2">
            {statusButtons.map((btn) => (
              <button
                type="button"
                key={btn.status}
                onClick={() => onStatusChange(item.id, btn.status)}
                aria-pressed={item.status === btn.status}
                className={`px-2 py-0.5 text-xs rounded-sc-sm border transition-all ${
                  item.status === btn.status
                    ? 'text-[var(--sc-text-on-accent)]'
                    : 'bg-[var(--sc-surface-elevated)] text-[var(--sc-text-secondary)] border-[var(--sc-border-subtle)] hover:text-[var(--sc-text-primary)]'
                }`}
                style={
                  item.status === btn.status
                    ? { backgroundColor: btn.color, borderColor: btn.color }
                    : {}
                }
              >
                {t(btn.labelKey)}
              </button>
            ))}
            {/* QNBS-v3: Phase 3 — Ask Copilot chip pre-fills the Copilot composer with the
                review item context so the user can get an explanation without copy-pasting. */}
            {isCopilotEnabled && (
              <button
                type="button"
                onClick={() => {
                  setCopilotDraftMessage(
                    t('copilot.askAboutReviewItem', {
                      severity: item.severity,
                      description: item.description,
                    }),
                  );
                  dispatch(copilotActions.setOpen(true));
                }}
                className="ms-auto px-2 py-0.5 text-xs rounded-sc-sm border border-[var(--sc-border-subtle)] text-[var(--sc-accent)] hover:bg-[var(--sc-surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
              >
                ✦ {t('copilot.askCopilot')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
