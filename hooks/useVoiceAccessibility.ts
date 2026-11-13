/**
 * useVoiceAccessibility hook — ARIA management and audio navigation for voice mode.
 * QNBS-v3: Ensures WCAG 2.2 compliance when voice drives UI changes.
 */

import { useCallback, useEffect } from 'react';
import { audioNavigator } from '../services/voice/audioNavigator';
import { localizeVoiceError } from '../services/voice/voiceErrorMessages';
import { useTranslation } from './useTranslation';
import { useVoice } from './useVoice';

export const useVoiceAccessibility = () => {
  const { mode, transcript, error, enabled } = useVoice();
  const { t } = useTranslation();

  // Announce voice mode changes to screen readers
  useEffect(() => {
    if (!enabled) return;

    let message: string | null = null;
    switch (mode) {
      case 'listening':
        message = 'Voice listening active. Speak now.';
        break;
      case 'processing':
        message = 'Processing voice command...';
        break;
      case 'speaking':
        message = 'Speaking feedback...';
        break;
      case 'dictating':
        message = 'Dictation active. Speak to insert text.';
        break;
      case 'inactive':
        // Do not announce inactive to avoid noise
        break;
    }

    if (message) {
      audioNavigator.announce(message, 'polite');
    }
  }, [mode, enabled]);

  // Announce errors assertively
  useEffect(() => {
    if (!enabled || !error) return;
    // QNBS-v3 (#1282): the prefix and a known service error follow the user's language.
    audioNavigator.announce(
      t('voice.error.announce', { message: localizeVoiceError(error, t) }),
      'assertive',
    );
  }, [error, enabled, t]);

  // Announce final transcript
  useEffect(() => {
    if (!enabled || !transcript || mode !== 'processing') return;
    audioNavigator.announce(`Heard: ${transcript}`, 'polite');
  }, [transcript, mode, enabled]);

  const focusNextLandmark = useCallback(() => {
    const label = audioNavigator.nextLandmark();
    if (label) {
      audioNavigator.announce(label, 'polite');
    }
    return label;
  }, []);

  const focusPreviousLandmark = useCallback(() => {
    const label = audioNavigator.previousLandmark();
    if (label) {
      audioNavigator.announce(label, 'polite');
    }
    return label;
  }, []);

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    audioNavigator.announce(message, priority);
  }, []);

  return {
    focusNextLandmark,
    focusPreviousLandmark,
    announce,
    scanLandmarks: audioNavigator.scanLandmarks.bind(audioNavigator),
  };
};
