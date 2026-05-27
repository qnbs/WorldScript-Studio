/**
 * Pipeline Progress Panel — Live status, metrics, and trace for the active pipeline.
 * QNBS-v3: Shows stage metrics, AI call counts, and elapsed time.
 */

import type React from 'react';
import { useMemo } from 'react';
import { useProForgeViewContext } from '../../contexts/ProForgeViewContext';
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
        <p className="text-sm text-[var(--sc-text-secondary)]">No pipeline running.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Current Status</h3>
          {isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--sc-accent)]">
              <span className="w-2 h-2 rounded-full bg-[var(--sc-accent)] animate-pulse" />
              {t(
                currentRun
                  ? (STAGE_LOADING_KEY[currentRun.activeStage] ?? 'proforge.loading.default')
                  : 'proforge.loading.default',
              )}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-sc-md bg-[var(--sc-surface-base)]">
            <p className="text-xs text-[var(--sc-text-secondary)]">Active Stage</p>
            <p className="text-sm font-medium mt-0.5 capitalize">{currentRun.activeStage}</p>
          </div>
          <div className="p-3 rounded-sc-md bg-[var(--sc-surface-base)]">
            <p className="text-xs text-[var(--sc-text-secondary)]">Status</p>
            <p className="text-sm font-medium mt-0.5 capitalize">{currentRun.status}</p>
          </div>
        </div>
      </div>

      {/* Active Stage Details */}
      {activeStageResult && (
        <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
          <h3 className="text-sm font-medium mb-3">Stage Details: {activeStageResult.stage}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricBox label="AI Calls" value={activeStageResult.metrics.aiCalls} />
            <MetricBox
              label="Tokens"
              value={activeStageResult.metrics.tokensConsumed.toLocaleString()}
            />
            <MetricBox
              label="Duration"
              value={`${(activeStageResult.metrics.durationMs / 1000).toFixed(1)}s`}
            />
            <MetricBox label="Items Found" value={activeStageResult.metrics.itemsFound} />
          </div>
          {activeStageResult.status === 'awaitingReview' && (
            <div className="mt-3 p-2 rounded-sc-md bg-[var(--sc-warning-muted)] text-xs text-[var(--sc-warning)]">
              ⚠️ This stage is awaiting your review. Click the stage button above to review items.
            </div>
          )}
        </div>
      )}

      {/* Overall Metrics */}
      {totalMetrics && (
        <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
          <h3 className="text-sm font-medium mb-3">Pipeline Totals</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricBox label="Total AI Calls" value={totalMetrics.aiCalls} />
            <MetricBox label="Total Tokens" value={totalMetrics.tokens.toLocaleString()} />
            <MetricBox label="Total Time" value={`${(totalMetrics.duration / 1000).toFixed(1)}s`} />
            <MetricBox label="Total Items" value={totalMetrics.itemsFound} />
          </div>
        </div>
      )}

      {/* Stage History */}
      {currentRun.stages.length > 0 && (
        <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
          <h3 className="text-sm font-medium mb-3">Completed Stages</h3>
          <div className="space-y-2">
            {currentRun.stages.map((stage) => (
              <div
                key={stage.stage}
                className="flex items-center justify-between p-2 rounded-sc-md bg-[var(--sc-surface-base)] text-xs"
              >
                <span className="capitalize font-medium">{stage.stage}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[var(--sc-text-secondary)]">
                    {stage.metrics.itemsFound} items
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-sc-sm capitalize"
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
                    {stage.status}
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
