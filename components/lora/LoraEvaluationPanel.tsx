/**
 * LoRA Evaluation Panel — Style Consistency Score + side-by-side prompt comparison
 * QNBS-v3: Uses loraEvaluationService for embedding-based scoring.
 */

import React, { useEffect, useState } from 'react';
import { useLoraViewContext } from '../../contexts/LoraViewContext';
import { useTranslation } from '../../hooks/useTranslation';

const DEFAULT_PROMPTS = [
  'Continue this scene where the protagonist discovers a hidden letter:',
  'Write a dialogue between two old friends meeting after ten years:',
  'Describe the atmosphere of a coastal town at dusk:',
];

// QNBS-v3: Dynamic import to enable code-splitting — loraEvaluationService is also dynamically imported in thunks.
const useLoraEvaluationService = () => {
  const [api, setApi] = useState<{ scoreLabel: (score: number) => string } | null>(null);
  useEffect(() => {
    void import('../../services/lora/loraEvaluationService')
      .then((m) => {
        setApi({ scoreLabel: m.scoreLabel });
      })
      .catch(() => {
        // QNBS-v3: Import failed — api stays null, component shows fallback UI
      });
  }, []);
  return api;
};

function ScoreGauge({
  score,
  scoreLabelFn,
}: {
  score: number;
  scoreLabelFn: (s: number) => string;
}) {
  const pct = Math.round(score * 100);
  const label = scoreLabelFn(score);
  // QNBS-v3: Semantic token colors replace hardcoded hex values for theme consistency.
  const color =
    label === 'excellent'
      ? 'var(--sc-success-fg)'
      : label === 'good'
        ? 'var(--sc-success-fg)'
        : label === 'partial'
          ? 'var(--sc-warning-fg)'
          : 'var(--sc-danger-fg)';
  return (
    <div
      className="flex flex-col items-center gap-2"
      role="img"
      aria-label={`Style score: ${pct}%`}
    >
      <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
        <circle
          cx="40"
          cy="40"
          r="32"
          fill="none"
          stroke="var(--sc-border-default)"
          strokeWidth="8"
        />
        <circle
          cx="40"
          cy="40"
          r="32"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${pct * 2.01} 201`}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="45" textAnchor="middle" fontSize="18" fontWeight="bold" fill="currentColor">
          {pct}
        </text>
      </svg>
      <span className="text-sm font-medium capitalize" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

export default React.memo(function LoraEvaluationPanel() {
  const { activeAdapter, evaluate, isEvaluating, lastEvaluation } = useLoraViewContext();
  const { t } = useTranslation();
  const [prompts] = useState<string[]>(DEFAULT_PROMPTS);
  const api = useLoraEvaluationService();

  const handleEvaluate = () => {
    if (!activeAdapter) return;
    evaluate(activeAdapter.id, prompts);
  };

  if (!activeAdapter) {
    return (
      <div className="py-16 text-center text-sm text-[var(--sc-text-secondary)]">
        {t('lora.evaluation.noActiveAdapter')}
      </div>
    );
  }

  return (
    <section className="space-y-6" aria-label={t('lora.evaluation.title')}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
          {t('lora.evaluation.title')}
        </h2>
        <button
          type="button"
          onClick={handleEvaluate}
          disabled={isEvaluating}
          className="rounded-sc-md bg-[var(--sc-interactive-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
        >
          {isEvaluating ? t('lora.evaluation.evaluating') : t('lora.evaluation.run')}
        </button>
      </div>

      {lastEvaluation && (
        <div className="space-y-6">
          {/* Score gauge */}
          <div className="flex flex-col items-center gap-2 rounded-sc-lg border border-[var(--sc-border-default)] bg-[var(--sc-surface-base)] p-6">
            {api ? (
              <ScoreGauge score={lastEvaluation.score} scoreLabelFn={api.scoreLabel} />
            ) : (
              <div className="text-sm text-[var(--sc-text-secondary)]">
                {t('lora.evaluation.loading')}
              </div>
            )}
            <div className="flex gap-6 text-xs text-[var(--sc-text-secondary)]">
              <span>
                {t('lora.evaluation.baseline')}: {Math.round(lastEvaluation.baseline * 100)}%
              </span>
              <span>
                {t('lora.evaluation.improvement')}: {lastEvaluation.improvement >= 0 ? '+' : ''}
                {Math.round(lastEvaluation.improvement * 100)}%
              </span>
            </div>
          </div>

          {/* Side-by-side comparisons */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--sc-text-primary)]">
              {t('lora.evaluation.compare')}
            </h3>
            {lastEvaluation.sampleComparisons.map((comparison) => (
              <div
                key={comparison.prompt.slice(0, 40)}
                className="rounded-sc-lg border border-[var(--sc-border-default)] bg-[var(--sc-surface-base)] p-4"
              >
                <p className="mb-3 text-xs font-medium text-[var(--sc-text-secondary)]">
                  {comparison.prompt}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[var(--sc-text-tertiary)]">
                      {t('lora.evaluation.base')}
                    </p>
                    <p className="rounded-sc-md bg-[var(--sc-surface-raised)] p-2 text-xs text-[var(--sc-text-primary)] leading-relaxed">
                      {comparison.base || '—'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[var(--sc-success-fg)]">
                      {t('lora.evaluation.adapted')} ({Math.round(comparison.similarity * 100)}%)
                    </p>
                    <p className="rounded-sc-md bg-[var(--sc-success-bg)] p-2 text-xs text-[var(--sc-text-primary)] leading-relaxed">
                      {comparison.adapted || '—'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
});
