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

// QNBS-v3: Author-facing stage names replace internal pipeline IDs — novelists understand editorial
// stages, not queue names. Values are i18n keys (proforge.dashboard.stageLabel.*) resolved via t().
const STAGE_LABEL_KEY: Record<PipelineStage, string> = {
  idle: 'proforge.dashboard.stageLabel.idle',
  intake: 'proforge.dashboard.stageLabel.intake',
  structural: 'proforge.dashboard.stageLabel.structural',
  lineProse: 'proforge.dashboard.stageLabel.lineProse',
  copyEdit: 'proforge.dashboard.stageLabel.copyEdit',
  proof: 'proforge.dashboard.stageLabel.proof',
  production: 'proforge.dashboard.stageLabel.production',
  publishing: 'proforge.dashboard.stageLabel.publishing',
  analytics: 'proforge.dashboard.stageLabel.analytics',
  archived: 'proforge.dashboard.stageLabel.archived',
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
    const label =
      pipelineLabel.trim() ||
      t('proforge.dashboard.defaultLabel', { date: new Date().toLocaleDateString() });
    void startPipeline(label, defaultConfig);
  }, [pipelineLabel, defaultConfig, startPipeline, t]);

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
            <span className="text-[var(--sc-text-on-accent)] font-bold text-sm">P</span>
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
              className="px-3 py-1.5 text-sm rounded-sc-md bg-[var(--sc-error)] text-[var(--sc-text-on-accent)] hover:opacity-90 transition-opacity"
              aria-label={t('proforge.dashboard.abortAria')}
            >
              {t('common.abort')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveView('trace')}
            className="px-3 py-1.5 text-sm rounded-sc-md bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-hover)] transition-colors"
            aria-label={t('proforge.dashboard.traceAria')}
          >
            {t('proforge.dashboard.trace')}
          </button>
        </div>
      </div>

      {/* Main Content */}
      {/* QNBS-v3: flex flex-col so children can use flex-1 instead of h-full — percentage heights
          inside overflow-y-auto resolve to 0 in Chrome when the flex chain has auto sizing. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {!currentRun ? (
          /* Start Screen */
          <div
            data-testid="proforge-empty-state"
            className="flex flex-col items-center justify-center flex-1 gap-6 p-8"
          >
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
                placeholder={t('proforge.dashboard.labelPlaceholder')}
                className="w-full px-3 py-2 rounded-sc-md bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              />
              <button
                type="button"
                onClick={handleStart}
                disabled={isLoading}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-sc-md text-[var(--sc-text-on-accent)] transition-opacity disabled:opacity-50"
                style={{ backgroundColor: 'var(--sc-accent)' }}
              >
                {isLoading ? t('proforge.dashboard.starting') : t('proforge.dashboard.start')}
              </button>
              <button
                type="button"
                onClick={() => setShowConfig(!showConfig)}
                className="w-full px-4 py-2 text-xs text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] transition-colors"
              >
                {showConfig
                  ? t('proforge.dashboard.hideConfig')
                  : t('proforge.dashboard.showConfig')}
              </button>
            </div>

            {showConfig && (
              <div className="w-full max-w-md p-4 rounded-sc-lg bg-[var(--sc-surface-elevated)] border border-[var(--sc-border-subtle)] text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">
                    {t('proforge.dashboard.config.genrePreset')}
                  </span>
                  <span>{defaultConfig.genrePreset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">
                    {t('proforge.dashboard.config.aiProvider')}
                  </span>
                  <span>{defaultConfig.aiProvider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">
                    {t('proforge.dashboard.config.ragMode')}
                  </span>
                  <span>{defaultConfig.ragMode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">
                    {t('proforge.dashboard.config.maxTokens')}
                  </span>
                  <span>{defaultConfig.maxTokens}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--sc-text-secondary)]">
                    {t('proforge.dashboard.config.creativity')}
                  </span>
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
              <h3 className="text-sm font-medium mb-3">{t('proforge.dashboard.stagesHeading')}</h3>
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
                        // QNBS-v3: color-mix keeps CSS variable stage colors valid (hex-alpha suffix only worked for literal hex).
                        backgroundColor:
                          status === 'pending'
                            ? 'var(--sc-surface-base)'
                            : `color-mix(in srgb, ${STAGE_COLORS[status]} 8%, transparent)`,
                        borderColor: STAGE_COLORS[status],
                        color: STAGE_COLORS[status],
                      }}
                      aria-current={active ? 'step' : undefined}
                    >
                      {t(STAGE_LABEL_KEY[stage])}
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
