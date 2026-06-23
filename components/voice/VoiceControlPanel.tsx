/**
 * VoiceControlPanel — floating panel for voice activation and control.
 * QNBS-v3: Opt-in UI that appears when voice is enabled in settings.
 */

import React, { useCallback } from 'react';
import { useMicLevel } from '../../hooks/useMicLevel';
import { useTranslation } from '../../hooks/useTranslation';
import { useVoice } from '../../hooks/useVoice';
import { Icon } from '../ui/Icon';
import { VoiceLevelMeter } from './VoiceLevelMeter';

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
    transcript,
    confidence,
  } = useVoice();
  // QNBS-v3 (CodeAnt): gate the (shared) mic meter on `enabled` so it never runs if voice was
  // disabled while a stale listening mode lingers.
  const level = useMicLevel(enabled && isListening);
  const confidencePct = Math.round(Math.min(1, Math.max(0, confidence ?? 0)) * 100);

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

  // QNBS-v3: stack the voice panel ABOVE the Copilot FAB (which anchors at bottom-20/md:bottom-4,
  // h-14) so the two no longer overlap in the shared bottom-right corner. Offsets clear the 3.5rem
  // FAB plus a small gap while staying clear of the mobile bottom-nav.
  if (microphonePermission === 'denied') {
    return (
      <div className="fixed bottom-[9.25rem] right-4 z-50 md:bottom-[5.25rem] p-3 rounded-[var(--radius-sc-lg)] bg-[var(--sc-surface-raised)] border border-[var(--sc-border)] shadow-lg">
        <p className="text-sm text-[var(--sc-text-primary)]">{t('voice.permissionDenied')}</p>
      </div>
    );
  }

  const isActive = mode !== 'inactive';

  return (
    <section
      className="fixed bottom-[9.25rem] right-4 z-50 md:bottom-[5.25rem] flex flex-col gap-2 p-2 rounded-[var(--radius-sc-lg)] bg-[var(--sc-surface-raised)] border border-[var(--sc-border)] shadow-lg"
      aria-label={t('voice.panelLabel')}
    >
      {/* QNBS-v3: visible mode chip — distinguishes command-listening from dictation, which were
          previously conveyed only by background colour (audit: voice modes not self-explanatory). */}
      {isActive && (
        <span className="text-[10px] text-center px-2 py-0.5 rounded-full bg-[var(--sc-surface-subtle)] text-[var(--sc-text-secondary)]">
          {dictationActive ? t('voice.modeChip.dictation') : t('voice.modeChip.commands')}
        </span>
      )}
      {/* QNBS-v3: PR5 — live feedback: mic level meter, interim transcript, and confidence. */}
      {isActive && (
        <div className="flex flex-col items-center gap-1 px-1">
          {isListening && <VoiceLevelMeter level={level} />}
          {transcript && (
            <p className="text-[10px] text-[var(--sc-text-secondary)] text-center max-w-[140px] line-clamp-2">
              {transcript}
            </p>
          )}
          {/* QNBS-v3 (CodeAnt): only with a current transcript + not in dictation — otherwise a
              prior utterance's lastConfidence (unchanged on session start) would show stale. */}
          {confidencePct > 0 && !!transcript && mode !== 'dictating' && (
            <span className="text-[10px] text-[var(--sc-text-muted)] tabular-nums">
              {t('voice.feedback.confidence', { percent: String(confidencePct) })}
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={handleToggleListening}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
          isActive
            ? 'bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)]'
            : 'bg-[var(--sc-surface-subtle)] text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-hover)]'
        }`}
        aria-pressed={isActive}
        aria-label={isListening ? t('voice.stopListening') : t('voice.startListening')}
        title={isListening ? t('voice.stopListening') : t('voice.startListening')}
      >
        <Icon name="microphone" size="md" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={handleToggleDictation}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
          dictationActive
            ? 'bg-[var(--sc-success-fg)] text-[var(--sc-text-on-accent)]'
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
