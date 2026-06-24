/**
 * Pipeline Progress Panel — Live status, metrics, and trace for the active pipeline.
 * QNBS-v3: Shows stage metrics, AI call counts, and elapsed time.
 */

import type React from 'react';
import { useMemo } from 'react';
import { useProForgeViewContext } from '../../contexts/ProForgeViewContext';
import { computePipelineProgress } from '../../features/proForge/pipelineProgress';
import type { PipelineStage } from '../../features/proForge/types';
import { useTranslation } from '../../hooks/useTranslation';

// QNBS-v3: Author-facing loading messages replace "Processing..." — each stage has its own voice.
const STAGE_LOADING_KEY: Partial<Record<PipelineStage, string>> = {
  intake: 'proforge.loading.intake',
  structural: 'proforge.loading.structural',
  lineProse: 'proforge.loading.lineProse',
  copyEdit: 'proforge.loading.copyEdit',
  proof: 'proforge.loading.proof',
  production: 'proforge.loading.production',
  publishing: 'proforge.loading.publishing',
  analytics: 'proforge.loading.analytics',
};

export const PipelineProgressPanel: React.FC = () => {
  const { currentRun, isLoading, activeStageResult } = useProForgeViewContext();
  const { t } = useTranslation();

  // QNBS-v3: localized stage/status labels — reuse the existing proforge.stageName.* set and the
  // proforge.status.* set so progress badges read in the user's language, not raw enum values.
  const stageName = (stage: string): string => t(`proforge.stageName.${stage}`);
  const statusLabel = (status: string): string => t(`proforge.status.${status}`);

  // QNBS-v3: PR7 — determinate overall progress (stage N of M / percent) for the active run.
  const progress = useMemo(() => computePipelineProgress(currentRun), [currentRun]);

  const totalMetrics = useMemo(() => {
    if (!currentRun) return null;
    const stages = currentRun.stages;
    return {
      aiCalls: stages.reduce((acc, s) => acc + s.metrics.aiCalls, 0),
      tokens: stages.reduce((acc, s) => acc + s.metrics.tokensConsumed, 0),
      duration: stages.reduce((acc, s) => acc + s.metrics.durationMs, 0),
      itemsFound: stages.reduce((acc, s) => acc + s.metrics.itemsFound, 0),
    };
  }, [currentRun]);

  if (!currentRun) {
    return (
      <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-6 text-center">
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {t('proforge.progress.noneRunning')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* QNBS-v3: PR7 — determinate overall progress bar */}
      <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">{t('proforge.progress.overall')}</h3>
          <span className="text-xs text-[var(--sc-text-secondary)]">
            {/* QNBS-v3: PR7 — only show "Stage N of M" when the active stage is actually one of the
                selected stages (activeIndex >= 1); otherwise a neutral label, never a coerced index. */}
            {progress.activeIndex > 0
              ? t('proforge.progress.stageOfTotal', {
                  current: progress.activeIndex,
                  total: progress.total,
                })
              : t('proforge.progress.preparing')}
          </span>
        </div>
        <div
          className="h-2 w-full rounded-sc-sm bg-[var(--sc-surface-base)] overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-label={t('proforge.progress.overall')}
        >
          <div
            className="h-full bg-[var(--sc-accent)] transition-[width] duration-sc-md ease-sc-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-[var(--sc-text-secondary)]">
          {t('proforge.progress.percentComplete', { percent: progress.percent })}
        </p>
      </div>

      {/* Status Card */}
      <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">{t('proforge.progress.currentStatus')}</h3>
          {isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--sc-accent)]">
              <span className="w-2 h-2 rounded-full bg-[var(--sc-accent)] animate-pulse" />
              {t(STAGE_LOADING_KEY[currentRun.activeStage] ?? 'proforge.loading.default')}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-sc-md bg-[var(--sc-surface-base)]">
            <p className="text-xs text-[var(--sc-text-secondary)]">
              {t('proforge.progress.activeStage')}
            </p>
            <p className="text-sm font-medium mt-0.5">{stageName(currentRun.activeStage)}</p>
          </div>
          <div className="p-3 rounded-sc-md bg-[var(--sc-surface-base)]">
            <p className="text-xs text-[var(--sc-text-secondary)]">
              {t('proforge.progress.statusLabel')}
            </p>
            <p className="text-sm font-medium mt-0.5">{statusLabel(currentRun.status)}</p>
          </div>
        </div>
      </div>

      {/* Active Stage Details */}
      {activeStageResult && (
        <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
          <h3 className="text-sm font-medium mb-3">
            {t('proforge.progress.stageDetails', { stage: stageName(activeStageResult.stage) })}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricBox
              label={t('proforge.progress.metric.aiCalls')}
              value={activeStageResult.metrics.aiCalls}
            />
            <MetricBox
              label={t('proforge.progress.metric.tokens')}
              value={activeStageResult.metrics.tokensConsumed.toLocaleString()}
            />
            <MetricBox
              label={t('proforge.progress.metric.duration')}
              value={`${(activeStageResult.metrics.durationMs / 1000).toFixed(1)}s`}
            />
            <MetricBox
              label={t('proforge.progress.metric.itemsFound')}
              value={activeStageResult.metrics.itemsFound}
            />
          </div>
          {activeStageResult.status === 'awaitingReview' && (
            <div className="mt-3 p-2 rounded-sc-md bg-[var(--sc-warning-muted)] text-xs text-[var(--sc-warning)]">
              {t('proforge.progress.awaitingReviewHint')}
            </div>
          )}
        </div>
      )}

      {/* Overall Metrics */}
      {totalMetrics && (
        <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
          <h3 className="text-sm font-medium mb-3">{t('proforge.progress.totals')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricBox
              label={t('proforge.progress.metric.totalAiCalls')}
              value={totalMetrics.aiCalls}
            />
            <MetricBox
              label={t('proforge.progress.metric.totalTokens')}
              value={totalMetrics.tokens.toLocaleString()}
            />
            <MetricBox
              label={t('proforge.progress.metric.totalTime')}
              value={`${(totalMetrics.duration / 1000).toFixed(1)}s`}
            />
            <MetricBox
              label={t('proforge.progress.metric.totalItems')}
              value={totalMetrics.itemsFound}
            />
          </div>
        </div>
      )}

      {/* Stage History */}
      {currentRun.stages.length > 0 && (
        <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
          <h3 className="text-sm font-medium mb-3">{t('proforge.progress.completedStages')}</h3>
          <div className="space-y-2">
            {currentRun.stages.map((stage) => (
              <div
                key={stage.stage}
                className="flex items-center justify-between p-2 rounded-sc-md bg-[var(--sc-surface-base)] text-xs"
              >
                <span className="font-medium">{stageName(stage.stage)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[var(--sc-text-secondary)]">
                    {t('proforge.progress.itemsCount', { count: stage.metrics.itemsFound })}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-sc-sm"
                    style={{
                      backgroundColor:
                        stage.status === 'accepted'
                          ? 'var(--sc-success-muted)'
                          : stage.status === 'failed'
                            ? 'var(--sc-error-muted)'
                            : stage.status === 'skipped'
                              ? 'var(--sc-surface-hover)'
                              : 'var(--sc-accent-muted)',
                      color:
                        stage.status === 'accepted'
                          ? 'var(--sc-success)'
                          : stage.status === 'failed'
                            ? 'var(--sc-error)'
                            : 'var(--sc-text-secondary)',
                    }}
                  >
                    {statusLabel(stage.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

PipelineProgressPanel.displayName = 'PipelineProgressPanel';

function MetricBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 rounded-sc-md bg-[var(--sc-surface-base)] text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-[var(--sc-text-secondary)] mt-0.5">{label}</p>
    </div>
  );
}
