// QNBS-v3: WCAG 2.2 AA download progress modal for WebLLM model loading.
//          All ARIA attributes are per the progressbar + dialog patterns.

import type { FC } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { gpuResourceManager } from '../../services/ai/gpuResourceManager';
import {
  inferenceProgressEmitter,
  type WebLlmLoadProgress,
} from '../../services/ai/inferenceProgressEmitter';
import { formatMegabytes, megabytesPerSecond } from '../../services/downloadProgressFormat';
import { abortActivePreload, retryLastPreload } from '../../services/localAiFacade';

export const LocalAiDownloadProgress: FC = () => {
  const { t, formatNumber } = useTranslation();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [progress, setProgress] = useState<WebLlmLoadProgress>(
    inferenceProgressEmitter.getWebLlmLoadingSnapshot(),
  );

  useEffect(() => {
    return inferenceProgressEmitter.subscribeWebLlmLoading(setProgress);
  }, []);

  // Auto-focus cancel button when modal opens
  useEffect(() => {
    if (progress.state === 'loading' || progress.state === 'error') {
      cancelRef.current?.focus();
    }
  }, [progress.state]);

  const isVisible = progress.state === 'loading' || progress.state === 'error';
  if (!isVisible) return null;

  const progressPct = Math.round(progress.progress * 100);
  const etaText =
    progress.estimatedSecondsRemaining !== null
      ? t<string>('settings.ai.localAi.downloadEta', {
          seconds: String(Math.round(progress.estimatedSecondsRemaining)),
        })
      : '';

  // QNBS-v3: aria-valuetext combines percentage + ETA for screen readers per WCAG 2.2 §4.1.3.
  const ariaValueText = etaText
    ? `${progressPct}% ${t<string>('settings.ai.localAi.downloadedLabel')}, ${etaText}`
    : `${progressPct}%`;

  // QNBS-v3 (#333 item 1): approximate — see WebLlmLoadProgress's own doc comment. Only shown once
  // both bounds are known (null whenever the active model id isn't in WEBLLM_MODEL_APPROX_MB).
  // QNBS-v3 (#333/Qodo): "~" prefix marks these as derived estimates, unlike the voice download UI's
  // measured bytes — avoids a new i18n key by reusing the tilde convention already in model labels.
  const sizeText =
    progress.loadedBytes != null && progress.totalBytes != null
      ? t<string>('settings.ai.localAi.downloadSize', {
          loaded: `~${formatMegabytes(progress.loadedBytes)}`,
          total: `~${formatMegabytes(progress.totalBytes)}`,
        })
      : '';
  const speedText =
    progress.bytesPerSecond != null
      ? t<string>('settings.ai.localAi.downloadSpeed', {
          speed: `~${formatNumber(megabytesPerSecond(progress.bytesPerSecond), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`,
        })
      : '';

  function handleCancel() {
    // QNBS-v3: actually abort the in-flight preload/worker task — not just hide the modal.
    abortActivePreload();
    gpuResourceManager.releaseGpu('webllm');
    inferenceProgressEmitter.reportWebLlmError(t<string>('settings.ai.localAi.downloadCancelled'));
  }

  function handleRetry() {
    inferenceProgressEmitter.reset();
    // QNBS-v3: Retry must restart the failed preload, not merely clear the error presentation.
    void retryLastPreload().catch((error: unknown) => {
      inferenceProgressEmitter.reportWebLlmError(
        error instanceof Error ? error.message : t<string>('settings.ai.localAi.downloadFailed'),
      );
    });
  }

  return (
    // QNBS-v3: Split backdrop (button) from dialog so interactive dismiss satisfies Biome noStaticElementInteractions.
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop button — pressing it cancels, same as the Cancel button */}
      <button
        type="button"
        aria-label={t<string>('settings.ai.localAi.cancelAriaLabel')}
        onClick={handleCancel}
        className="absolute inset-0 bg-black/60"
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative mx-4 w-full max-w-sm rounded-xl bg-[var(--sc-surface-raised)] p-6 shadow-2xl"
      >
        <h2 id={titleId} className="mb-4 text-base font-semibold text-[var(--sc-text-primary)]">
          {t<string>('settings.ai.localAi.downloadTitle')}
        </h2>

        {progress.state === 'error' ? (
          // ─── Error state ───────────────────────────────────────────────────────
          <>
            {/* QNBS-v3: assertive for errors — user must act. */}
            <p
              role="alert"
              aria-live="assertive"
              className="mb-4 text-sm text-[var(--sc-danger-fg)]"
            >
              {progress.text}
            </p>
            <div className="flex gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={handleCancel}
                aria-label={t<string>('settings.ai.localAi.cancelAriaLabel')}
                className="flex-1 rounded-lg border border-[var(--sc-border-subtle)] px-4 py-2 text-sm font-medium text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:outline-none"
              >
                {t<string>('settings.ai.localAi.cancelButton')}
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="flex-1 rounded-lg bg-[var(--sc-accent)] px-4 py-2 text-sm font-medium text-[var(--sc-text-on-accent)] hover:bg-[var(--sc-accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:outline-none"
              >
                {t<string>('settings.ai.localAi.retryButton')}
              </button>
            </div>
          </>
        ) : (
          // ─── Loading state ─────────────────────────────────────────────────────
          <>
            {/* QNBS-v3: polite for progress — updated no more than every 2s to avoid screen-reader spam. */}
            <p aria-live="polite" className="mb-3 text-sm text-[var(--sc-text-secondary)]">
              {progress.text}
            </p>

            <div
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={ariaValueText}
              aria-label={t<string>('settings.ai.localAi.progressAriaLabel')}
              className="mb-1 h-2 w-full overflow-hidden rounded-full bg-[var(--sc-surface-overlay)]"
            >
              <div
                className="h-full rounded-full bg-[var(--sc-accent)] transition-all duration-300 ease-out"
                style={{ width: `${progressPct}%` }}
                aria-hidden="true"
              />
            </div>

            <div
              className={`flex justify-between text-xs text-[var(--sc-text-muted)] ${sizeText || speedText ? 'mb-1' : 'mb-4'}`}
            >
              <span>{progressPct}%</span>
              {etaText && <span>{etaText}</span>}
            </div>
            {(sizeText || speedText) && (
              <div className="mb-4 flex justify-between text-xs text-[var(--sc-text-muted)]">
                <span>{sizeText}</span>
                {speedText && <span>{speedText}</span>}
              </div>
            )}

            <button
              ref={cancelRef}
              type="button"
              onClick={handleCancel}
              aria-label={t<string>('settings.ai.localAi.cancelAriaLabel')}
              className="w-full rounded-lg border border-[var(--sc-border-subtle)] px-4 py-2 text-sm font-medium text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:outline-none"
            >
              {t<string>('settings.ai.localAi.cancelButton')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
