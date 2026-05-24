/**
 * VoiceIndicator — compact status indicator for voice mode.
 * QNBS-v3: Shows listening/processing/dictation state in the UI chrome.
 */

import React from 'react';
import { useVoice } from '../../hooks/useVoice';

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
  const { mode, enabled, transcript } = useVoice();

  if (!enabled) return null;

  const config = MODE_CONFIG[mode as VoiceModeKey] ?? MODE_CONFIG.inactive;

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
      {transcript && mode !== 'inactive' && (
        <span className="text-xs text-[var(--sc-text-muted)] truncate max-w-[120px]">
          {transcript}
        </span>
      )}
    </div>
  );
});
