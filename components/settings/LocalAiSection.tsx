// QNBS-v3: "Local AI" settings section — makes on-device inference legible & controllable.
//          Surfaces device capability, per-model download with storage warnings, on-disk cache
//          management ("Clear Local Models"), the fallback chain, and last-measured throughput.
//          Reuses existing services; the only new logic is localModelStorageService.

import { detectWebGpuSupport, WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import { useTranslation } from '../../hooks/useTranslation';
import {
  type DeviceClass,
  type DeviceHealthReport,
  getHealthReport,
  getModelRecommendation,
} from '../../services/ai/deviceHealthService';
import { inferenceProgressEmitter } from '../../services/ai/inferenceProgressEmitter';
import {
  clearLocalModels,
  estimateLocalModelStorage,
  type LocalModelStorageEstimate,
  WEBLLM_MODEL_APPROX_MB,
} from '../../services/ai/localModelStorageService';
import {
  abortActivePreload,
  clearReadyLocalModels,
  getLastLocalThroughput,
  getReadyLocalModelIds,
  isLocalAiBusy,
  type LocalThroughputSample,
  preloadLocalModel,
} from '../../services/localAiFacade';
import { logger } from '../../services/logger';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { LocalAiDownloadProgress } from './LocalAiDownloadProgress';

const DEVICE_CLASS_KEY: Record<DeviceClass, string> = {
  'high-end': 'settings.ai.gpu.deviceHighEnd',
  'mid-range': 'settings.ai.gpu.deviceMidRange',
  'low-end': 'settings.ai.gpu.deviceLowEnd',
  unknown: 'settings.ai.gpu.deviceUnknown',
};

// QNBS-v3: Localized display label per model id (descriptors like "eco"/"fast"/"high-end" are
//          translatable; the raw @domain/ai-core label is the fallback for unknown ids).
const MODEL_LABEL_KEY: Record<string, string> = {
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': 'settings.ai.localAi.modelLabel.qwen25_05b',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC': 'settings.ai.localAi.modelLabel.llama32_1b',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': 'settings.ai.localAi.modelLabel.llama32_3b',
  'Phi-4-mini-instruct-q4f16_1-MLC': 'settings.ai.localAi.modelLabel.phi4mini',
  'gemma-3-1b-it-q4f16_1-MLC': 'settings.ai.localAi.modelLabel.gemma3_1b',
  'gemma-3-4b-it-q4f32_1-MLC': 'settings.ai.localAi.modelLabel.gemma3_4b',
  'Llama-3.3-70B-Instruct-q3f16_1-MLC': 'settings.ai.localAi.modelLabel.llama33_70b',
};

// QNBS-v3: The four local-inference layers, in the exact order runLocalTextGeneration tries them.
const FALLBACK_LAYER_KEYS = [
  'settings.ai.localAi.fallbackLayer1',
  'settings.ai.localAi.fallbackLayer2',
  'settings.ai.localAi.fallbackLayer3',
  'settings.ai.localAi.fallbackLayer4',
] as const;

function modelLabel(id: string): string {
  return WEBLLM_SUPPORTED_MODELS.find((m) => m.id === id)?.label ?? id;
}

export const LocalAiSection: FC = () => {
  const { t } = useTranslation();
  const announce = useAnnounce();

  const [hasWebGpu] = useState<boolean>(() => {
    try {
      return detectWebGpuSupport();
    } catch {
      return false;
    }
  });
  const [report, setReport] = useState<DeviceHealthReport | null>(null);
  const [storage, setStorage] = useState<LocalModelStorageEstimate | null>(null);
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [throughput, setThroughput] = useState<LocalThroughputSample | null>(null);
  // QNBS-v3: reactive "a WebLLM download is running somewhere" flag (Copilot/ProForge/Writer/preload),
  //          so Clear locks out even when this section didn't start the download.
  const [externalLoading, setExternalLoading] = useState(false);

  useEffect(
    () =>
      inferenceProgressEmitter.subscribeWebLlmLoading((s) =>
        setExternalLoading(s.state === 'loading'),
      ),
    [],
  );

  // QNBS-v3: i18n-driven display label (falls back to the raw catalog label for unknown ids).
  const labelOf = useCallback(
    (id: string) => {
      const key = MODEL_LABEL_KEY[id];
      return key ? t(key) : modelLabel(id);
    },
    [t],
  );

  // QNBS-v3: monotonic request id so an older, slower estimate can't overwrite a newer result
  //          (initial load vs post-download/post-clear refreshes can overlap).
  const storageReqId = useRef(0);
  const refreshStorage = useCallback(async () => {
    const id = ++storageReqId.current;
    const est = await estimateLocalModelStorage();
    if (id === storageReqId.current) setStorage(est);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await getHealthReport();
      if (active) setReport(r);
    })();
    void refreshStorage();
    // QNBS-v3: seed from the session-level ready set so badges survive section remounts on nav.
    setReadyIds(new Set(getReadyLocalModelIds()));
    setThroughput(getLastLocalThroughput());
    return () => {
      active = false;
      // QNBS-v3: navigating away cancels any in-flight download rather than leaking GPU work.
      abortActivePreload();
    };
  }, [refreshStorage]);

  const handleDownload = useCallback(
    async (modelId: string) => {
      setDownloadingId(modelId);
      try {
        // QNBS-v3: Only a verified WebLLM warm of the REQUESTED model counts as "ready" — an
        //          ONNX/Transformers fallback (e.g. no WebGPU) must not mark a WebLLM model ready.
        const { downloaded } = await preloadLocalModel(modelId);
        setThroughput(getLastLocalThroughput());
        void refreshStorage();
        if (downloaded) {
          setReadyIds((prev) => new Set(prev).add(modelId));
          announce(
            t('settings.ai.localAi.modelReadyAnnounce', { model: labelOf(modelId) }),
            'polite',
          );
        }
      } catch (err) {
        // QNBS-v3: the click handler drops this promise (void), so swallow + surface here rather
        //          than leak an unhandled rejection to the global handler.
        logger.warn('LocalAiSection: model preload failed', { modelId, err: String(err) });
        announce(t('settings.ai.localAi.downloadFailed'), 'polite');
      } finally {
        setDownloadingId(null);
      }
    },
    [announce, t, labelOf, refreshStorage],
  );

  const handleClear = useCallback(async () => {
    // QNBS-v3: authoritative re-check at execution time — block if any local-AI work is in flight
    //          app-wide (GPU mutex held or a WebLLM download running), not just this section's.
    if (isLocalAiBusy()) {
      announce(t('settings.ai.localAi.clearBusy'), 'polite');
      setConfirmingClear(false);
      return;
    }
    setClearing(true);
    try {
      const { clearedCaches } = await clearLocalModels();
      clearReadyLocalModels();
      setReadyIds(new Set());
      await refreshStorage();
      announce(
        t('settings.ai.localAi.clearedAnnounce', { count: String(clearedCaches) }),
        'polite',
      );
    } catch (err) {
      logger.warn('LocalAiSection: clear local models failed', { err: String(err) });
      announce(t('settings.ai.localAi.clearFailed'), 'polite');
    } finally {
      setClearing(false);
      setConfirmingClear(false);
    }
  }, [announce, t, refreshStorage]);

  const recommendedId = report ? getModelRecommendation('text-gen', report) : null;
  const freeMb = storage?.freeMb ?? null;

  return (
    <div className="space-y-6">
      {/* QNBS-v3: mounted here too so the download modal overlays while on the Local AI page
          (it subscribes to the singleton emitter; only one Settings category renders at a time). */}
      <LocalAiDownloadProgress />

      {/* ── Capability ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-[var(--sc-text-primary)]">
            {t('settings.ai.localAi.sectionTitle')}
          </h2>
          <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">
            {t('settings.ai.localAi.sectionDescription')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg bg-[var(--sc-surface-overlay)] px-3 py-2">
              <dt className="text-xs text-[var(--sc-text-muted)]">
                {t('settings.ai.localAi.webgpuLabel')}
              </dt>
              <dd
                className={`text-sm font-medium ${hasWebGpu ? 'text-[var(--sc-success-fg)]' : 'text-[var(--sc-warning-fg)]'}`}
              >
                {hasWebGpu
                  ? t('settings.ai.localAi.webgpuAvailable')
                  : t('settings.ai.localAi.webgpuUnavailable')}
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[var(--sc-surface-overlay)] px-3 py-2">
              <dt className="text-xs text-[var(--sc-text-muted)]">
                {t('settings.ai.localAi.deviceClassLabel')}
              </dt>
              <dd className="text-sm font-medium text-[var(--sc-text-primary)]">
                {report
                  ? t(DEVICE_CLASS_KEY[report.deviceClass])
                  : t('settings.ai.localAi.detecting')}
              </dd>
            </div>
          </dl>

          {recommendedId && (
            <p className="text-sm text-[var(--sc-text-secondary)]">
              {t('settings.ai.localAi.recommendedModel', { model: labelOf(recommendedId) })}
            </p>
          )}

          {readyIds.size === 0 && (
            <p className="rounded-lg bg-[var(--sc-info-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--sc-info-fg)]">
              {t('settings.ai.localAi.onboardingHint')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Model manager ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-[var(--sc-text-primary)]">
            {t('settings.ai.localAi.modelsTitle')}
          </h3>
          <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">
            {t('settings.ai.localAi.modelsDescription')}
          </p>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {WEBLLM_SUPPORTED_MODELS.map((m) => {
              const approxMb = WEBLLM_MODEL_APPROX_MB[m.id] ?? 0;
              const tooLarge = freeMb !== null && approxMb > 0 && approxMb > freeMb;
              const isReady = readyIds.has(m.id);
              const isDownloading = downloadingId === m.id;
              // QNBS-v3: also block when a WebLLM download is running anywhere (externalLoading) so
              //          preloads can't overlap and the single global cancel hook stays unambiguous.
              const disabled =
                isDownloading || downloadingId !== null || clearing || externalLoading;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--sc-border-subtle)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--sc-text-primary)]">
                      {labelOf(m.id)}
                    </p>
                    {tooLarge && (
                      <p className="mt-0.5 text-xs text-[var(--sc-warning-fg)]">
                        {t('settings.ai.localAi.sizeWarning', {
                          size: String(approxMb),
                          free: String(freeMb),
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isReady && (
                      <span className="rounded-full bg-[var(--sc-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--sc-success-fg)]">
                        {t('settings.ai.localAi.readyBadge')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDownload(m.id)}
                      disabled={disabled}
                      className="rounded-lg border border-[var(--sc-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
                    >
                      {isDownloading
                        ? t('settings.ai.localAi.downloadingButton')
                        : t('settings.ai.localAi.downloadButton')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!hasWebGpu && (
            <p className="mt-3 text-xs text-[var(--sc-text-muted)]">
              {t('settings.ai.localAi.requiresGpuNote')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Storage management ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-[var(--sc-text-primary)]">
            {t('settings.ai.localAi.storageTitle')}
          </h3>
        </CardHeader>
        <CardContent className="space-y-3">
          {storage?.estimateAvailable ? (
            <>
              <p className="text-sm text-[var(--sc-text-secondary)]">
                {t('settings.ai.localAi.storageUsage', {
                  used: String(storage.usageMb ?? 0),
                  quota: String(storage.quotaMb ?? 0),
                  percent: String(storage.usagePercent ?? 0),
                })}
              </p>
              <div
                role="progressbar"
                aria-valuenow={storage.usagePercent ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('settings.ai.localAi.storageAriaLabel')}
                className="h-2 w-full overflow-hidden rounded-full bg-[var(--sc-surface-overlay)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--sc-accent)]"
                  style={{ width: `${Math.min(100, storage.usagePercent ?? 0)}%` }}
                  aria-hidden="true"
                />
              </div>
            </>
          ) : (
            // QNBS-v3: no usable quota from the StorageManager — say so rather than render a bogus 0.
            <p className="text-sm text-[var(--sc-text-muted)]">
              {t('settings.ai.localAi.storageUnsupported')}
            </p>
          )}

          {storage && (
            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.ai.localAi.storageModelsCached', {
                count: String(storage.modelCacheCount),
              })}
            </p>
          )}

          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            // QNBS-v3: never clear while a download is in flight — that would race clearLocalModels()
            //          against active worker preload/download work and corrupt the cache state.
            disabled={
              !storage || storage.modelCacheCount === 0 || downloadingId !== null || externalLoading
            }
            className="rounded-lg border border-[var(--sc-danger-border)] px-3 py-1.5 text-xs font-medium text-[var(--sc-danger-fg)] hover:bg-[var(--sc-danger-bg)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
          >
            {t('settings.ai.localAi.clearButton')}
          </button>

          {/* QNBS-v3: destructive confirm via the shared Modal — focus trap + restore + Escape
              + alertdialog semantics, matching the factory-reset pattern. */}
          <Modal
            isOpen={confirmingClear}
            onClose={() => {
              if (!clearing) setConfirmingClear(false);
            }}
            title={t('settings.ai.localAi.clearButton')}
            variant="alertdialog"
          >
            <p className="mb-4 text-sm text-[var(--sc-text-secondary)]">
              {t('settings.ai.localAi.clearConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                disabled={clearing}
                className="rounded-lg border border-[var(--sc-border-subtle)] px-4 py-2 text-sm font-medium text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              >
                {t('settings.ai.localAi.clearCancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={clearing || downloadingId !== null || externalLoading}
                className="rounded-lg bg-[var(--sc-danger-fg)] px-4 py-2 text-sm font-medium text-[var(--sc-text-on-accent)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              >
                {clearing
                  ? t('settings.ai.localAi.clearingButton')
                  : t('settings.ai.localAi.clearConfirmYes')}
              </button>
            </div>
          </Modal>
        </CardContent>
      </Card>

      {/* ── Fallback chain + perf ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-[var(--sc-text-primary)]">
            {t('settings.ai.localAi.fallbackTitle')}
          </h3>
          <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">
            {t('settings.ai.localAi.fallbackIntro')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal space-y-1 ps-5 text-sm text-[var(--sc-text-secondary)]">
            {FALLBACK_LAYER_KEYS.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ol>
          <p className="text-xs text-[var(--sc-text-muted)]">
            {throughput
              ? t('settings.ai.localAi.perfThroughput', {
                  tps: String(throughput.tokensPerSecond),
                })
              : t('settings.ai.localAi.perfNoData')}
          </p>
          <a
            href="https://github.com/qnbs/StoryCraft-Studio/blob/main/docs/LOCAL-AI.md"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-medium text-[var(--sc-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
          >
            {t('settings.ai.localAi.docsLink')}
          </a>
        </CardContent>
      </Card>
    </div>
  );
};
