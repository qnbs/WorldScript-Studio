/**
 * ProForge Dashboard — Main pipeline workflow interface.
 * QNBS-v3: Central hub showing pipeline status, stage navigation, and controls.
 */

import type React from 'react';
import { useCallback, useState } from 'react';
import { useProForgeViewContext } from '../../contexts/ProForgeViewContext';
import { PIPELINE_STAGES, type PipelineStage } from '../../features/proForge/types';
import { PipelineProgressPanel } from './PipelineProgressPanel';
import { PipelineReviewPanel } from './PipelineReviewPanel';

// QNBS-v3: Author-facing stage names replace internal pipeline IDs — novelists understand editorial stages, not queue names.
const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'Ready',
  intake: '1. Reading Your Draft',
  structural: '2. Shaping the Story',
  lineProse: '3. Polishing the Prose',
  copyEdit: '4. Copy Editing',
  proof: '5. Final Proof',
  production: '6. Preparing Your Files',
  publishing: '7. Publishing Prep',
  analytics: '8. Run Summary',
  archived: 'Archived',
};

const STAGE_COLORS: Record<string, string> = {
  pending: 'var(--sc-text-tertiary)',
  running: 'var(--sc-accent)',
  awaitingReview: 'var(--sc-warning)',
  accepted: 'var(--sc-success)',
  rejected: 'var(--sc-error)',
  skipped: 'var(--sc-text-tertiary)',
  failed: 'var(--sc-error)',
  rolledBack: 'var(--sc-text-tertiary)',
};

export const ProForgeDashboard: React.FC = () => {
  const {
    t,
    currentRun,
    isLoading,
    activeView,
    activeStageResult,
    defaultConfig,
    startPipeline,
    abortPipeline,
    setActiveView,
  } = useProForgeViewContext();

  const [pipelineLabel, setPipelineLabel] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  const handleStart = useCallback(() => {
    const label = pipelineLabel.trim() || `Pipeline ${new Date().toLocaleDateString()}`;
    void startPipeline(label, defaultConfig);
  }, [pipelineLabel, defaultConfig, startPipeline]);

  const handleAbort = useCallback(() => {
    void abortPipeline();
  }, [abortPipeline]);

  const getStageStatus = (stage: PipelineStage): string => {
    if (!currentRun) return 'pending';
    const result = currentRun.stages.find((s) => s.stage === stage);
    return result?.status ?? 'pending';
  };

  const isStageActive = (stage: PipelineStage): boolean => {
    return currentRun?.activeStage === stage;
  };

  return (
    <div className="flex flex-col h-full bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--sc-border-subtle)]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-sc-md flex items-center justify-center"
            style={{ backgroundColor: 'var(--sc-accent)' }}
          >
            <span className="text-white font-bold text-sm">P</span>
          </div>
          <div>
            <h2 className="text-base font-semibold">{t('proforge.pipeline.title')}</h2>
            <p className="text-xs text-[var(--sc-text-tertiary)]">
              {currentRun ? currentRun.label : t('proforge.pipeline.noneActive')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentRun?.status === 'running' && (
            <button
              type="button"
              onClick={handleAbort}
              className="px-3 py-1.5 text-sm rounded-sc-md bg-[var(--sc-error)] text-white hover:opacity-90 transition-opacity"
              aria-label="Abort pipeline"
            >
              {t('common.abort')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveView('trace')}
            className="px-3 py-1.5 text-sm rounded-sc-md bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-hover)] transition-colors"
            aria-label="View trace log"
          >
            Trace
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {!currentRun ? (
          /* Start Screen */
          <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
            <div className="text-center max-w-md">
              <div
                className="w-16 h-16 rounded-sc-xl mx-auto mb-4 flex items-center justify-center"
                style={{ backgroundColor: 'var(--sc-accent-muted)' }}
              >
                <span className="text-2xl">🔥</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">{t('proforge.emptyState.title')}</h3>
              <p className="text-sm text-[var(--sc-text-secondary)] mb-6">
                {t('proforge.emptyState.description')}
              </p>
            </div>

            <div className="w-full max-w-md space-y-3">
              <input
                type="text"
                value={pipelineLabel}
                onChange={(e) => setPipelineLabel(e.target.value)}
                placeholder="Pipeline label (optional)"
                className="w-full px-3 py-2 rounded-sc-md bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sc-ring-focus)]"
              />
              <button
                type="button"
                onClick={handleStart}
                disabled={isLoading}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-sc-md text-white transition-opacity disabled:opacity-50"
                style={{ backgroundColor: 'var(--sc-accent)' }}
              >
                {isLoading ? 'Starting...' : 'Start Pipeline'}
              </button>
              <button
                type="button"
                onClick={() => setShowConfig(!showConfig)}
                className="w-full px-4 py-2 text-xs text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] transition-colors"
              >
                {showConfig ? 'Hide Configuration' : 'Show Configuration'}
              </button>
            </div>

            {showConfig && (
              <div className="w-full max-w-md p-4 rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">Genre Preset:</span>
                  <span>{defaultConfig.genrePreset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">AI Provider:</span>
                  <span>{defaultConfig.aiProvider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">RAG Mode:</span>
                  <span>{defaultConfig.ragMode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">Max Tokens:</span>
                  <span>{defaultConfig.maxTokens}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">Creativity:</span>
                  <span>{defaultConfig.creativity}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Active Pipeline View */
          <div className="p-4 space-y-4">
            {/* Stage Pipeline */}
            <div className="rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] p-4">
              <h3 className="text-sm font-medium mb-3">Pipeline Stages</h3>
              <div className="flex flex-wrap gap-2">
                {PIPELINE_STAGES.filter((s) => s !== 'idle' && s !== 'archived').map((stage) => {
                  const status = getStageStatus(stage);
                  const active = isStageActive(stage);
                  return (
                    <button
                      type="button"
                      key={stage}
                      onClick={() => {
                        if (status === 'awaitingReview') {
                          setActiveView('review');
                        }
                      }}
                      className={`px-3 py-1.5 rounded-sc-md text-xs font-medium border transition-all ${
                        active ? 'ring-2 ring-[var(--sc-ring-focus)]' : ''
                      }`}
                      style={{
                        backgroundColor:
                          status === 'pending'
                            ? 'var(--sc-surface-base)'
                            : `${STAGE_COLORS[status]}15`,
                        borderColor: STAGE_COLORS[status],
                        color: STAGE_COLORS[status],
                      }}
                      aria-current={active ? 'step' : undefined}
                    >
                      {STAGE_LABELS[stage]}
                      {status === 'running' && (
                        <span className="ml-1.5 inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Progress or Review */}
            {activeView === 'review' && activeStageResult?.status === 'awaitingReview' ? (
              <PipelineReviewPanel />
            ) : (
              <PipelineProgressPanel />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

ProForgeDashboard.displayName = 'ProForgeDashboard';
