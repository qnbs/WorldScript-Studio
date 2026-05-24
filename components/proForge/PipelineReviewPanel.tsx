/**
 * Pipeline Review Panel — Human-in-the-Loop diff view and approval interface.
 * QNBS-v3: Shows review items with accept/reject/ignore actions per item and batch.
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

  const filteredItems = useMemo(() => {
    if (filter === 'all') return currentStageReviewItems;
    return currentStageReviewItems.filter((i) => i.status === filter);
  }, [currentStageReviewItems, filter]);

  const pendingCount = currentStageReviewItems.filter((i) => i.status === 'pending').length;
  const acceptedCount = currentStageReviewItems.filter((i) => i.status === 'accepted').length;
  const rejectedCount = currentStageReviewItems.filter((i) => i.status === 'rejected').length;

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
        <div className="flex items-center gap-2">
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

      {/* Filter Tabs */}
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

      {/* Review Items List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filteredItems.length === 0 ? (
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
