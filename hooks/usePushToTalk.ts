/**
 * usePushToTalk hook — hold-to-talk voice activation.
 * QNBS-v3: Listens for the configured PTT key combo when voice is in push-to-talk mode.
 */

import { useEffect, useRef } from 'react';
import { useAppSelector } from '../app/hooks';
import { selectVoiceSettings } from '../features/settings/settingsSlice';
import { selectVoiceMode } from '../features/voice/voiceSlice';
import { logger } from '../services/logger';
import { getVoiceService } from '../services/voice/voiceCommandService';

export const usePushToTalk = () => {
  const voiceSettings = useAppSelector(selectVoiceSettings);
  const mode = useAppSelector(selectVoiceMode);
  const isListeningRef = useRef(false);

  useEffect(() => {
    if (!voiceSettings.enabled || voiceSettings.activationMode !== 'pushToTalk') {
      return;
    }

    // QNBS-v3: PTT uses Ctrl+Shift+V as default. In future, this reads from keyboard shortcut registry.
    const onKeyDown = (e: KeyboardEvent) => {
      if (isListeningRef.current) return;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        isListeningRef.current = true;
        void getVoiceService()
          .startListening()
          .catch((err: unknown) => {
            logger.error('PTT start failed:', err);
            isListeningRef.current = false;
          });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isListeningRef.current) return;
      // Release PTT when any of the modifier keys is released
      if (e.key === 'Control' || e.key === 'Shift' || e.key.toLowerCase() === 'v') {
        isListeningRef.current = false;
        void getVoiceService().stopListening();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [voiceSettings.enabled, voiceSettings.activationMode]);

  // Cleanup when mode changes away from listening
  useEffect(() => {
    if (mode === 'inactive') {
      isListeningRef.current = false;
    }
  }, [mode]);
};
