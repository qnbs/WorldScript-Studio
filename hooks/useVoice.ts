/**
 * useVoice hook — primary interface for Voice Full Support in components.
 * QNBS-v3: Bridges Redux state with the VoiceCommandService singleton.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { appStoreRef } from '../app/store';
import { selectEnableVoiceWasm } from '../features/featureFlags/featureFlagsSlice';
import { selectVoiceSettings } from '../features/settings/settingsSlice';
import {
  resetVoiceState,
  selectDictationActive,
  selectMicrophonePermission,
  selectSttStatus,
  selectTtsStatus,
  selectVoiceError,
  selectVoiceMode,
  selectVoiceProcessing,
  selectVoiceTranscript,
} from '../features/voice/voiceSlice';
import { ecoModeService } from '../services/ai/ecoModeService';
import { logger } from '../services/logger';
import type { VoiceServiceConfig } from '../services/voice/voiceCommandService';
import { getVoiceService } from '../services/voice/voiceCommandService';

export const useVoice = () => {
  const dispatch = useAppDispatch();
  const voiceSettings = useAppSelector(selectVoiceSettings);
  const enableVoiceWasm = useAppSelector(selectEnableVoiceWasm);
  const serviceRef = useRef(getVoiceService());

  // Sync service config with Redux settings whenever they change.
  // QNBS-v3: B5 — eco-mode overrides engine selection when battery is low.
  useEffect(() => {
    const svc = serviceRef.current;
    const eco = ecoModeService.isEcoMode();
    const config: Partial<VoiceServiceConfig> = {
      // Eco-mode forces lightweight WebSpeech fallback to save power
      preferredSttEngine: eco ? 'webSpeech' : voiceSettings.sttEngine,
      preferredTtsEngine: eco ? 'webSpeech' : voiceSettings.ttsEngine,
      feedbackLevel: voiceSettings.feedbackLevel,
      speechRate: voiceSettings.speechRate,
      speechVolume: voiceSettings.speechVolume,
      allowCloudFallback: voiceSettings.allowCloudSttFallback,
      listeningTimeoutSeconds: voiceSettings.listeningTimeoutSeconds,
      wakeWordPhrase: voiceSettings.wakeWordPhrase,
      ttsMuted: voiceSettings.ttsMuted,
      dictationAutoPunctuation: voiceSettings.dictationAutoPunctuation,
      enableVoiceWasm: enableVoiceWasm || eco,
    };
    svc.updateConfig(config);
  }, [voiceSettings, enableVoiceWasm]);

  // QNBS-v3: B5 — subscribe to eco-mode changes and immediately re-apply config.
  useEffect(() => {
    const svc = serviceRef.current;
    return ecoModeService.onEcoModeChange((isEco) => {
      svc.updateConfig({
        preferredSttEngine: isEco ? 'webSpeech' : voiceSettings.sttEngine,
        preferredTtsEngine: isEco ? 'webSpeech' : voiceSettings.ttsEngine,
        enableVoiceWasm: enableVoiceWasm || isEco,
      });
    });
  }, [voiceSettings, enableVoiceWasm]);

  // Provide dispatch and getState to service once
  useEffect(() => {
    serviceRef.current.setDispatch(dispatch, () => appStoreRef.current!.getState());
  }, [dispatch]);

  const mode = useAppSelector(selectVoiceMode);
  const isListening = mode === 'listening' || mode === 'dictating';
  const error = useAppSelector(selectVoiceError);
  const transcript = useAppSelector(selectVoiceTranscript);
  const processing = useAppSelector(selectVoiceProcessing);
  const sttStatus = useAppSelector(selectSttStatus);
  const ttsStatus = useAppSelector(selectTtsStatus);
  const microphonePermission = useAppSelector(selectMicrophonePermission);
  const dictationActive = useAppSelector(selectDictationActive);

  const startListening = useCallback(async () => {
    if (!voiceSettings.enabled) {
      logger.warn('Voice not enabled');
      return;
    }
    try {
      await serviceRef.current.startListening();
    } catch (err) {
      logger.error('Failed to start voice listening:', err);
    }
  }, [voiceSettings.enabled]);

  const stopListening = useCallback(async () => {
    try {
      await serviceRef.current.stopListening();
    } catch (err) {
      logger.error('Failed to stop voice listening:', err);
    }
  }, []);

  const startDictation = useCallback(async () => {
    if (!voiceSettings.enabled) return;
    try {
      await serviceRef.current.startDictation();
    } catch (err) {
      logger.error('Failed to start dictation:', err);
    }
  }, [voiceSettings.enabled]);

  const stopDictation = useCallback(async () => {
    try {
      await serviceRef.current.stopDictation();
    } catch (err) {
      logger.error('Failed to stop dictation:', err);
    }
  }, []);

  const speakFeedback = useCallback(async (text: string) => {
    await serviceRef.current.speak(text);
  }, []);

  const cancelSpeech = useCallback(() => {
    serviceRef.current.cancelSpeech();
  }, []);

  const reset = useCallback(() => {
    dispatch(resetVoiceState());
  }, [dispatch]);

  const completeOnboarding = useCallback(() => {
    serviceRef.current.completeOnboarding();
  }, []);

  return useMemo(
    () => ({
      // State
      mode,
      isListening,
      error,
      transcript,
      processing,
      sttStatus,
      ttsStatus,
      microphonePermission,
      dictationActive,
      enabled: voiceSettings.enabled,
      // Actions
      startListening,
      stopListening,
      startDictation,
      stopDictation,
      speakFeedback,
      cancelSpeech,
      reset,
      completeOnboarding,
    }),
    [
      mode,
      isListening,
      error,
      transcript,
      processing,
      sttStatus,
      ttsStatus,
      microphonePermission,
      dictationActive,
      voiceSettings.enabled,
      startListening,
      stopListening,
      startDictation,
      stopDictation,
      speakFeedback,
      cancelSpeech,
      reset,
      completeOnboarding,
    ],
  );
};
