/**
 * VoiceControlPanel — floating panel for voice activation and control.
 * QNBS-v3: Opt-in UI that appears when voice is enabled in settings.
 */

import React, { useCallback } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { useVoice } from '../../hooks/useVoice';

export const VoiceControlPanel = React.memo(function VoiceControlPanel() {
  const { t } = useTranslation();
  const {
    enabled,
    mode,
    isListening,
    dictationActive,
    startListening,
    stopListening,
    startDictation,
    stopDictation,
    cancelSpeech,
    microphonePermission,
  } = useVoice();

  const handleToggleListening = useCallback(() => {
    if (isListening) {
      void stopListening();
    } else {
      void startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleToggleDictation = useCallback(() => {
    if (dictationActive) {
      void stopDictation();
    } else {
      void startDictation();
    }
  }, [dictationActive, startDictation, stopDictation]);

  if (!enabled) return null;

  if (microphonePermission === 'denied') {
    return (
      <div className="fixed bottom-4 right-4 z-50 p-3 rounded-[var(--radius-sc-lg)] bg-[var(--sc-surface-raised)] border border-[var(--sc-border)] shadow-lg">
        <p className="text-sm text-[var(--sc-text-primary)]">{t('voice.permissionDenied')}</p>
      </div>
    );
  }

  const isActive = mode !== 'inactive';

  return (
    <section
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 p-2 rounded-[var(--radius-sc-lg)] bg-[var(--sc-surface-raised)] border border-[var(--sc-border)] shadow-lg"
      aria-label={t('voice.panelLabel')}
    >
      <button
        type="button"
        onClick={handleToggleListening}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
          isActive
            ? 'bg-[var(--sc-accent)] text-white'
            : 'bg-[var(--sc-surface-subtle)] text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-hover)]'
        }`}
        aria-pressed={isActive}
        aria-label={isListening ? t('voice.stopListening') : t('voice.startListening')}
        title={isListening ? t('voice.stopListening') : t('voice.startListening')}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleToggleDictation}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
          dictationActive
            ? 'bg-[var(--sc-success)] text-white'
            : 'bg-[var(--sc-surface-subtle)] text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-hover)]'
        }`}
        aria-pressed={dictationActive}
        aria-label={dictationActive ? t('voice.stopDictation') : t('voice.startDictation')}
        title={dictationActive ? t('voice.stopDictation') : t('voice.startDictation')}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
          <path d="M17.5 2.5a2.121 2.121 0 1 1 3 3L10 16l-4 1 1-4Z" />
        </svg>
      </button>

      {isActive && (
        <button
          type="button"
          onClick={cancelSpeech}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--sc-surface-subtle)] text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-hover)]"
          aria-label={t('voice.cancelSpeech')}
          title={t('voice.cancelSpeech')}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="9" x2="15" y2="15" />
            <line x1="15" y1="9" x2="9" y2="15" />
          </svg>
        </button>
      )}
    </section>
  );
});
