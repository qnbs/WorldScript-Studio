/**
 * Pipeline Review Panel — Human-in-the-Loop diff view and approval interface.
 * QNBS-v3: P-5 redesign — severity-grouped layout with Critical Actions summary card
 * and Quick Accept High-Confidence to reduce decision fatigue on large review sets.
 */

import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useProForgeViewContext } from '../../contexts/ProForgeViewContext';
import { proForgeActions } from '../../features/proForge/proForgeSlice';
import type { ReviewItem, ReviewItemStatus } from '../../features/proForge/types';

const SEVERITY_ICONS: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

const TYPE_LABELS: Record<string, string> = {
  structuralEdit: 'Structural',
  proseEdit: 'Prose',
  grammarEdit: 'Grammar',
  styleEdit: 'Style',
  repetitionHit: 'Repetition',
  consistencyIssue: 'Consistency',
  plotHole: 'Plot Hole',
  legalWarning: 'Legal',
  technicalIssue: 'Technical',
  pacingIssue: 'Pacing',
  arcIssue: 'Arc',
};

const SEVERITY_GROUPS = [
  {
    key: 'critical' as const,
    label: 'Critical Actions',
    headerClass: 'text-[var(--sc-error)] border-[var(--sc-error-muted)]',
    badgeClass: 'bg-[var(--sc-error-muted)] text-[var(--sc-error)]',
  },
  {
    key: 'warning' as const,
    label: 'Warnings',
    headerClass: 'text-[var(--sc-warning,#d97706)] border-[var(--sc-warning-muted,#fef3c7)]',
    badgeClass: 'bg-[var(--sc-warning-muted,#fef3c7)] text-[var(--sc-warning,#d97706)]',
  },
  {
    key: 'info' as const,
    label: 'Suggestions',
    headerClass: 'text-[var(--sc-accent)] border-[var(--sc-accent-muted,#eff6ff)]',
    badgeClass: 'bg-[var(--sc-accent-muted,#eff6ff)] text-[var(--sc-accent)]',
  },
] as const;

export const PipelineReviewPanel: React.FC = () => {
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

  const handleSubmit = useCallback(() => {
    if (!stage) return;
    const items = activeStageResult?.reviewItems ?? [];
    const decisions = items.map((item) => ({ itemId: item.id, status: item.status }));
    void submitReview(stage, decisions);
    setActiveView('dashboard');
  }, [stage, activeStageResult, submitReview, setActiveView]);

  const handleSkip = useCallback(() => {
    if (!stage) return;
    skipStage(stage);
    setActiveView('dashboard');
  }, [stage, skipStage, setActiveView]);

  if (!currentRun || !stage) {
    return (
      <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-6 text-center">
        <p className="text-sm text-[var(--sc-text-secondary)]">No review items available.</p>
      </div>
    );
  }

  return (
    <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] flex flex-col max-h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--sc-border-subtle)]">
        <div>
          <h3 className="text-sm font-medium capitalize">Review: {stage}</h3>
          <p className="text-xs text-[var(--sc-text-secondary)] mt-0.5">
            {pendingCount} pending · {acceptedCount} accepted · {rejectedCount} rejected
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {quickAcceptCount > 0 && (
            <button
              type="button"
              onClick={handleQuickAcceptHighConfidence}
              className="px-2.5 py-1 text-xs rounded-sc-md bg-[var(--sc-accent-muted,#eff6ff)] text-[var(--sc-accent)] hover:opacity-80 transition-opacity"
              title="Accept all high-confidence non-critical suggestions"
            >
              Quick Accept ({quickAcceptCount})
            </button>
          )}
          <button
            type="button"
            onClick={handleAcceptAll}
            className="px-2.5 py-1 text-xs rounded-sc-md bg-[var(--sc-success-muted)] text-[var(--sc-success)] hover:opacity-80 transition-opacity"
          >
            Accept All
          </button>
          <button
            type="button"
            onClick={handleRejectAll}
            className="px-2.5 py-1 text-xs rounded-sc-md bg-[var(--sc-error-muted)] text-[var(--sc-error)] hover:opacity-80 transition-opacity"
          >
            Reject All
          </button>
        </div>
      </div>

      {/* Critical Actions Summary Card */}
      {criticalPending.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-sc-md border border-[var(--sc-error-muted)] bg-[var(--sc-error-muted)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--sc-error)]">
              🔴 {criticalPending.length} Critical{' '}
              {criticalPending.length === 1 ? 'Issue' : 'Issues'} Need Attention
            </span>
            <button
              type="button"
              onClick={handleAcceptAllCritical}
              className="px-2 py-0.5 text-xs rounded-sc-sm bg-[var(--sc-error)] text-white hover:opacity-80 transition-opacity"
            >
              Accept All Critical
            </button>
          </div>
          {topCritical.map((item) => (
            <div key={item.id} className="text-xs text-[var(--sc-error)] truncate mt-1">
              · {item.description}
            </div>
          ))}
          {criticalPending.length > 3 && (
            <div className="text-xs text-[var(--sc-error)] mt-1 opacity-70">
              +{criticalPending.length - 3} more critical issues below
            </div>
          )}
        </div>
      )}

      {/* Filter Tabs — secondary position */}
      <div className="flex gap-1 px-4 pt-3">
        {(['all', 'pending', 'accepted', 'rejected'] as const).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-xs rounded-sc-md capitalize transition-colors ${
              filter === f
                ? 'bg-[var(--sc-accent)] text-white'
                : 'bg-[var(--sc-surface-base)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'
            }`}
          >
            {f} (
            {f === 'all'
              ? currentStageReviewItems.length
              : currentStageReviewItems.filter((i) => i.status === f).length}
            )
          </button>
        ))}
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
                  <span className="text-xs font-semibold">{group.label}</span>
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
            No items match this filter.
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
          Skip Stage
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pendingCount > 0}
          className="px-4 py-1.5 text-xs font-medium rounded-sc-md text-white disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--sc-accent)' }}
        >
          {pendingCount > 0 ? `${pendingCount} Pending` : 'Submit & Continue'}
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
  const [expanded, setExpanded] = useState(false);

  const statusButtons: { status: ReviewItemStatus; label: string; color: string }[] = [
    { status: 'accepted', label: 'Accept', color: 'var(--sc-success)' },
    { status: 'rejected', label: 'Reject', color: 'var(--sc-error)' },
    { status: 'ignored', label: 'Ignore', color: 'var(--sc-text-tertiary)' },
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
        <span className="text-sm mt-0.5">{SEVERITY_ICONS[item.severity]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-sc-sm bg-[var(--sc-surface-elevated)]">
              {TYPE_LABELS[item.type] ?? item.type}
            </span>
            {item.sectionTitle && (
              <span className="text-xs text-[var(--sc-text-secondary)] truncate">
                {item.sectionTitle}
              </span>
            )}
            <span className="text-xs text-[var(--sc-text-tertiary)] ml-auto">
              {Math.round(item.confidence * 100)}% confidence
            </span>
          </div>
          <p className="text-sm mt-1.5">{item.description}</p>

          {item.original && item.proposed && expanded && (
            <div className="mt-2 space-y-1.5 text-xs">
              <div className="p-2 rounded-sc-sm bg-[var(--sc-error-muted)] text-[var(--sc-error)]">
                <span className="font-medium">Original:</span> {item.original}
              </div>
              <div className="p-2 rounded-sc-sm bg-[var(--sc-success-muted)] text-[var(--sc-success)]">
                <span className="font-medium">Proposed:</span> {item.proposed}
              </div>
            </div>
          )}

          {item.rationale && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-[var(--sc-accent)] mt-1 hover:underline"
            >
              {expanded ? 'Show less' : 'Show details'}
            </button>
          )}

          {/* Status Actions */}
          <div className="flex gap-2 mt-2">
            {statusButtons.map((btn) => (
              <button
                type="button"
                key={btn.status}
                onClick={() => onStatusChange(item.id, btn.status)}
                className={`px-2 py-0.5 text-xs rounded-sc-sm border transition-all ${
                  item.status === btn.status
                    ? 'text-white'
                    : 'bg-[var(--sc-surface-elevated)] text-[var(--sc-text-secondary)] border-[var(--sc-border-subtle)] hover:text-[var(--sc-text-primary)]'
                }`}
                style={
                  item.status === btn.status
                    ? { backgroundColor: btn.color, borderColor: btn.color }
                    : {}
                }
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
