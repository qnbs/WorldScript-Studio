/**
 * LoRA Adapter Library
 * QNBS-v3: Full adapter management — list, activate, deactivate, delete, export, version history.
 *          Replaces LoraAdapterSection.tsx in settings for the LoRA view.
 */

import React from 'react';
import { useLoraViewContext } from '../../contexts/LoraViewContext';
import type { LoraAdapter } from '../../features/lora/types';
import { useTranslation } from '../../hooks/useTranslation';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ScoreBadge({ score }: { score?: number }) {
  if (score === undefined) return null;
  const pct = Math.round(score * 100);
  const color =
    score >= 0.7
      ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
      : score >= 0.5
        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
        : 'bg-[var(--sc-surface-raised)] text-[var(--sc-text-secondary)]';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{pct}%</span>;
}

function AdapterCard({ adapter }: { adapter: LoraAdapter }) {
  const { activateAdapter, deactivateAdapter, deleteAdapter } = useLoraViewContext();
  const { t } = useTranslation();

  const handleToggle = () => {
    if (adapter.isActive) {
      deactivateAdapter();
    } else {
      activateAdapter(adapter.id);
    }
  };

  return (
    <article
      className={`rounded-sc-lg border p-4 transition-colors ${
        adapter.isActive
          ? 'border-[var(--sc-border-focus)] bg-[var(--sc-surface-raised)]'
          : 'border-[var(--sc-border-default)] bg-[var(--sc-surface-base)]'
      }`}
      aria-label={adapter.name}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-[var(--sc-text-primary)]">{adapter.name}</h3>
            {adapter.isActive && (
              <span className="shrink-0 rounded-full bg-[var(--sc-interactive-primary)] px-2 py-0.5 text-xs text-white">
                {t('lora.adapter.active')}
              </span>
            )}
            {adapter.qualityScore !== undefined && <ScoreBadge score={adapter.qualityScore} />}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--sc-text-secondary)]">
            {adapter.modelCompatibility} · {formatBytes(adapter.fileSizeBytes)}
            {adapter.version !== undefined && ` · v${adapter.version}`}
          </p>
          {adapter.description && (
            <p className="mt-1 text-xs text-[var(--sc-text-tertiary)] line-clamp-2">
              {adapter.description}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleToggle}
            className="rounded-sc-md bg-[var(--sc-surface-raised)] px-3 py-1 text-xs font-medium text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-elevated)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
            aria-pressed={adapter.isActive}
          >
            {adapter.isActive ? t('lora.adapter.deactivate') : t('lora.adapter.activate')}
          </button>
          <button
            type="button"
            onClick={() => deleteAdapter(adapter.id)}
            className="rounded-sc-md p-1.5 text-[var(--sc-text-secondary)] hover:text-[var(--sc-status-error)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
            aria-label={t('lora.adapter.delete')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M6 2h4a1 1 0 0 1 1 1v1H5V3a1 1 0 0 1 1-1zM3 5h10l-1 9H4L3 5zm3 2v5h1V7H6zm3 0v5h1V7H9z" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}

export default React.memo(function LoraAdapterLibrary() {
  const { adapters, openWizard, isTraining } = useLoraViewContext();
  const { t } = useTranslation();

  if (adapters.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <span className="text-4xl" aria-hidden="true">
          🖊
        </span>
        <p className="max-w-xs text-sm text-[var(--sc-text-secondary)]">
          {t('lora.library.empty')}
        </p>
        <button
          type="button"
          onClick={openWizard}
          disabled={isTraining}
          className="rounded-sc-md bg-[var(--sc-interactive-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] disabled:opacity-50"
        >
          {t('lora.wizard.startFirstTraining')}
        </button>
      </div>
    );
  }

  return (
    <section aria-label={t('lora.library.title')}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
          {t('lora.library.title')}
        </h2>
        <button
          type="button"
          onClick={openWizard}
          disabled={isTraining}
          className="rounded-sc-md bg-[var(--sc-interactive-primary)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] disabled:opacity-50"
        >
          {t('lora.wizard.trainNew')}
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {adapters.map((adapter) => (
          <AdapterCard key={adapter.id} adapter={adapter} />
        ))}
      </div>
    </section>
  );
});
