/**
 * VoiceModelDownloadModal — Progress UI for downloading WASM voice models.
 * QNBS-v3: P0-5 — Whisper STT + Kokoro TTS model download with cancel/retry.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { settingsActions } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { formatMegabytes, megabytesPerSecond } from '../../services/downloadProgressFormat';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Progress } from '../ui/Progress';

interface VoiceModelDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelType: 'stt' | 'tts';
}

// Model sizes in MB for progress estimation
const MODEL_SIZES = {
  whisper: 42,
  kokoro: 15,
} as const;

export const VoiceModelDownloadModal = React.memo(function VoiceModelDownloadModal({
  isOpen,
  onClose,
  modelType,
}: VoiceModelDownloadModalProps) {
  const { t, formatNumber } = useTranslation();
  const dispatch = useAppDispatch();
  const progress = useAppSelector((s) => s.settings.voice.wasmModelDownloadProgress ?? 0);
  // QNBS-v3 (#333 item 1): real bytes from transformers.js's own progress payload (not an
  // approximation — see wasmModelDownloadLoadedBytes's doc comment in types.ts).
  const loadedBytes = useAppSelector((s) => s.settings.voice.wasmModelDownloadLoadedBytes);
  const totalBytes = useAppSelector((s) => s.settings.voice.wasmModelDownloadTotalBytes);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // QNBS-v3: CodeAnt P2-3 — AbortController lets cancel button stop an in-flight download
  const abortRef = useRef<AbortController | null>(null);
  // QNBS-v3 (#333/CodeRabbit+Qodo): delta-based rate from consecutive byte samples — the prior
  // cumulative-bytes/elapsed-since-start calc included startup time and smoothed out real throughput
  // changes into a misleading average, not a live rate.
  const prevSampleRef = useRef<{ bytes: number; atMs: number } | null>(null);
  const [bytesPerSecond, setBytesPerSecond] = useState<number | null>(null);

  useEffect(() => {
    if (!isDownloading) {
      prevSampleRef.current = null;
      setBytesPerSecond(null);
      return;
    }
    if (loadedBytes == null) return;
    const now = Date.now();
    const prev = prevSampleRef.current;
    if (prev) {
      const elapsedSeconds = (now - prev.atMs) / 1000;
      const deltaBytes = loadedBytes - prev.bytes;
      if (elapsedSeconds > 0.5 && deltaBytes >= 0) {
        setBytesPerSecond(deltaBytes / elapsedSeconds);
      }
    }
    prevSampleRef.current = { bytes: loadedBytes, atMs: now };
  }, [isDownloading, loadedBytes]);

  const handleDownload = useCallback(async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsDownloading(true);
    setError(null);

    try {
      // Trigger model download via voice service, passing the abort signal
      const { downloadVoiceModels } = await import('../../services/voice/voiceCommandService');
      await downloadVoiceModels(modelType, ctrl.signal);

      if (ctrl.signal.aborted) return;

      dispatch(
        settingsActions.setVoiceSettings({
          wasmModelsReady: true,
        }),
      );
      onClose();
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!ctrl.signal.aborted) {
        setIsDownloading(false);
      }
    }
  }, [dispatch, onClose, modelType]);

  const handleCancel = useCallback(() => {
    // Abort any in-flight download before closing
    abortRef.current?.abort();
    abortRef.current = null;
    setIsDownloading(false);
    // QNBS-v3 (#333/CodeAnt+Qodo): reset progress AND byte counts — the service's own abort branch
    // doesn't dispatch, so a cancel mid-download would otherwise leave stale bytes for the next attempt.
    dispatch(
      settingsActions.setVoiceSettings({
        wasmModelDownloadProgress: 0,
        wasmModelDownloadLoadedBytes: undefined,
        wasmModelDownloadTotalBytes: undefined,
      }),
    );
    onClose();
  }, [dispatch, onClose]);

  useEffect(() => {
    // QNBS-v3: P1-2 — guard on !error so a failed download (which resets progress to 0) does NOT
    //          auto-retry in a loop; the user retries via the explicit Retry button instead.
    if (isOpen && !isDownloading && !error && progress === 0) {
      void handleDownload();
    }
  }, [isOpen, isDownloading, error, progress, handleDownload]);

  const modelName = modelType === 'stt' ? 'Whisper (STT)' : 'Kokoro (TTS)';
  const modelSize = modelType === 'stt' ? MODEL_SIZES.whisper : MODEL_SIZES.kokoro;

  // QNBS-v3 (#333 item 1): real byte counts once the first progress tick with them has arrived;
  // MODEL_SIZES above is only the pre-download estimate shown in the description text.
  const sizeText =
    loadedBytes != null && totalBytes != null
      ? t('voice.modelDownload.progressBytes', {
          loaded: formatMegabytes(loadedBytes),
          total: formatMegabytes(totalBytes),
        })
      : '';
  const speedText =
    bytesPerSecond != null
      ? t('voice.modelDownload.speed', {
          speed: formatNumber(megabytesPerSecond(bytesPerSecond), {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        })
      : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={t('voice.modelDownload.title')}
      size="default"
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {t('voice.modelDownload.description', { model: modelName, size: String(modelSize) })}
        </p>

        {isDownloading && (
          <>
            {/* QNBS-v3: C-P1 — labelled progressbar + polite live region so the percentage is announced. */}
            <Progress
              value={Math.round(progress * 100)}
              aria-label={t('voice.modelDownload.title')}
            />
            <p className="text-xs text-[var(--sc-text-tertiary)]" aria-live="polite">
              {t('voice.modelDownload.progress', { percent: String(Math.round(progress * 100)) })}
            </p>
            {(sizeText || speedText) && (
              <p className="flex justify-between text-xs text-[var(--sc-text-tertiary)]">
                <span>{sizeText}</span>
                {speedText && <span>{speedText}</span>}
              </p>
            )}
          </>
        )}

        {error && (
          <p className="text-sm text-[var(--sc-danger-fg)]" role="alert">
            {t('voice.modelDownload.error', { error })}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={handleCancel} disabled={!isDownloading}>
            {t('voice.modelDownload.cancel')}
          </Button>
          {error && (
            <Button variant="primary" onClick={handleDownload}>
              {t('voice.modelDownload.retry')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
});
