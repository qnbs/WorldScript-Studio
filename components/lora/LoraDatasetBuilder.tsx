/**
 * LoRA Dataset Builder
 * QNBS-v3: Extract, score, filter, and export training dataset from project manuscript.
 */

import React, { useCallback } from 'react';
import { useLoraViewContext } from '../../contexts/LoraViewContext';
import type { DatasetFormat } from '../../features/lora/types';
import { useTranslation } from '../../hooks/useTranslation';
import { estimateDatasetQuality, exportAsJsonl } from '../../services/lora/loraDatasetBuilder';

function QualityBadge({ score }: { score: number }) {
  const color =
    score >= 0.6
      ? 'text-green-600'
      : score >= 0.4
        ? 'text-yellow-600'
        : 'text-[var(--sc-status-error)]';
  return <span className={`text-xs font-mono ${color}`}>{(score * 100).toFixed(0)}%</span>;
}

export default React.memo(function LoraDatasetBuilder() {
  const { datasetEntries, buildDataset, isBuilding } = useLoraViewContext();
  const { t } = useTranslation();

  const quality = estimateDatasetQuality(datasetEntries);

  const handleExport = useCallback(
    (format: DatasetFormat) => {
      const jsonl = exportAsJsonl(datasetEntries, format);
      const blob = new Blob([jsonl], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `storycraft-dataset-${format}-${Date.now()}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [datasetEntries],
  );

  return (
    <section aria-label={t('lora.dataset.title')} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
          {t('lora.dataset.title')}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => buildDataset()}
            disabled={isBuilding}
            className="rounded-sc-md bg-[var(--sc-interactive-primary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
          >
            {isBuilding ? t('lora.dataset.extracting') : t('lora.dataset.extract')}
          </button>
          {datasetEntries.length > 0 && (
            <button
              type="button"
              onClick={() => handleExport('alpaca')}
              className="rounded-sc-md border border-[var(--sc-border-default)] px-3 py-1.5 text-sm text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
            >
              {t('lora.dataset.export')} JSONL
            </button>
          )}
        </div>
      </div>

      {datasetEntries.length > 0 && (
        <>
          {/* Quality summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t('lora.dataset.total'), value: quality.totalEntries },
              { label: t('lora.dataset.accepted'), value: quality.acceptedEntries },
              { label: t('lora.dataset.flagged'), value: quality.flaggedEntries },
              { label: t('lora.dataset.rejected'), value: quality.rejectedEntries },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-sc-md border border-[var(--sc-border-default)] bg-[var(--sc-surface-base)] p-3 text-center"
              >
                <div className="text-2xl font-bold text-[var(--sc-text-primary)]">{value}</div>
                <div className="text-xs text-[var(--sc-text-secondary)]">{label}</div>
              </div>
            ))}
          </div>

          {!quality.readyToTrain && (
            <p className="rounded-sc-md bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              {t('lora.dataset.notEnough')}
            </p>
          )}

          {/* Entry list (first 20) */}
          <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label={t('lora.dataset.entries')}>
            {datasetEntries.slice(0, 20).map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-3 rounded-sc-md border border-[var(--sc-border-default)] bg-[var(--sc-surface-base)] px-3 py-2"
              >
                <QualityBadge score={entry.qualityScore} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[var(--sc-text-primary)]">
                    {entry.instruction}
                  </p>
                  <p className="truncate text-xs text-[var(--sc-text-tertiary)]">
                    {entry.output.slice(0, 80)}…
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--sc-surface-raised)] px-1.5 py-0.5 text-xs text-[var(--sc-text-secondary)]">
                  {entry.source === 'synthetic'
                    ? t('lora.dataset.synthetic')
                    : t('lora.dataset.extracted')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {datasetEntries.length === 0 && !isBuilding && (
        <p className="py-8 text-center text-sm text-[var(--sc-text-secondary)]">
          {t('lora.dataset.empty')}
        </p>
      )}
    </section>
  );
});
