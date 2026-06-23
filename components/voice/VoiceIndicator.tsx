/**
 * VoiceIndicator — compact status indicator for voice mode.
 * QNBS-v3: Shows listening/processing/dictation state in the UI chrome.
 */

import React from 'react';
import { useMicLevel } from '../../hooks/useMicLevel';
import { useTranslation } from '../../hooks/useTranslation';
import { useVoice } from '../../hooks/useVoice';
import { VoiceLevelMeter } from './VoiceLevelMeter';

type VoiceModeKey = 'inactive' | 'listening' | 'processing' | 'speaking' | 'dictating';

const MODE_CONFIG: Record<VoiceModeKey, { labelKey: string; colorClass: string; pulse: boolean }> =
  {
    inactive: {
      labelKey: 'voice.status.inactive',
      colorClass: 'bg-[var(--sc-surface-subtle)]',
      pulse: false,
    },
    listening: {
      labelKey: 'voice.status.listening',
      colorClass: 'bg-[var(--sc-accent)]',
      pulse: true,
    },
    processing: {
      labelKey: 'voice.status.processing',
      colorClass: 'bg-[var(--sc-info)]',
      pulse: false,
    },
    speaking: {
      labelKey: 'voice.status.speaking',
      colorClass: 'bg-[var(--sc-success)]',
      pulse: false,
    },
    dictating: {
      labelKey: 'voice.status.dictating',
      colorClass: 'bg-[var(--sc-accent)]',
      pulse: true,
    },
  };

export const VoiceIndicator = React.memo(function VoiceIndicator() {
  const { mode, enabled, transcript, confidence } = useVoice();
  const { t } = useTranslation();
  const isActive = mode === 'listening' || mode === 'dictating';
  // QNBS-v3 (CodeAnt): gate the (shared) mic meter on `enabled` too, so it never runs if voice was
  // disabled while a stale listening/dictating mode lingers.
  const level = useMicLevel(enabled && isActive);

  if (!enabled) return null;

  const config = MODE_CONFIG[mode as VoiceModeKey] ?? MODE_CONFIG.inactive;
  const confidencePct = Math.round(Math.min(1, Math.max(0, confidence ?? 0)) * 100);
  // QNBS-v3 (CodeAnt): show confidence only alongside a current transcript (a new listening session
  // clears transcript but leaves lastConfidence), and not in dictation (which appends text without
  // updating lastConfidence) or inactive — so a stale prior-utterance score is never shown.
  const showConfidence =
    confidencePct > 0 && !!transcript && mode !== 'dictating' && mode !== 'inactive';

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 rounded-[var(--radius-sc-md)] text-[var(--sc-text-primary)]"
      style={{ backgroundColor: 'var(--sc-surface-raised)' }}
      role="status"
      aria-live="polite"
      aria-label={`Voice status: ${mode}`}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${config.colorClass} ${config.pulse ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <span className="text-xs font-medium capitalize">{mode}</span>
      {isActive && <VoiceLevelMeter level={level} />}
      {transcript && mode !== 'inactive' && (
        <span className="text-xs text-[var(--sc-text-muted)] truncate max-w-[120px]">
          {transcript}
        </span>
      )}
      {showConfidence && (
        <span className="text-[10px] text-[var(--sc-text-muted)] tabular-nums shrink-0">
          {t('voice.feedback.confidence', { percent: String(confidencePct) })}
        </span>
      )}
    </div>
  );
});
