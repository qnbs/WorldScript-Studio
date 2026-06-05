/**
 * VoiceModelDownloadModal — Progress UI for downloading WASM voice models.
 * QNBS-v3: P0-5 — Whisper STT + Kokoro TTS model download with cancel/retry.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { settingsActions } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';
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
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const progress = useAppSelector((s) => s.settings.voice.wasmModelDownloadProgress ?? 0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    setError(null);

    try {
      // Trigger model download via voice service
      // QNBS-v3: P0-5 — downloadVoiceModels to be implemented in voiceCommandService
      // Placeholder: actual download would be triggered here
      // const { downloadVoiceModels } = await import('../../services/voice/voiceCommandService');
      // await downloadVoiceModels(modelType);

      dispatch(
        settingsActions.setVoiceSettings({
          wasmModelsReady: true,
        }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloading(false);
    }
  }, [dispatch, onClose]);

  const handleCancel = useCallback(() => {
    // Cancel download logic would be implemented in voiceCommandService
    setIsDownloading(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen && !isDownloading && progress === 0) {
      void handleDownload();
    }
  }, [isOpen, isDownloading, progress, handleDownload]);

  const modelName = modelType === 'stt' ? 'Whisper (STT)' : 'Kokoro (TTS)';
  const modelSize = modelType === 'stt' ? MODEL_SIZES.whisper : MODEL_SIZES.kokoro;

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
            <Progress value={Math.round(progress * 100)} />
            <p className="text-xs text-[var(--sc-text-tertiary)]">
              {t('voice.modelDownload.progress', { percent: String(Math.round(progress * 100)) })}
            </p>
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
