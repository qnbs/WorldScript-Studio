import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { VoiceSttEngine, VoiceTtsEngine } from '../../types';

export type VoiceEngineStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
export type VoiceMode = 'inactive' | 'listening' | 'processing' | 'speaking' | 'dictating';

export interface VoiceState {
  /** Current operational mode of the voice subsystem */
  mode: VoiceMode;
  /** Last error message, if any */
  error: string | null;
  /** Current or last transcript from STT */
  transcript: string;
  /** Whether an intent is being processed */
  processing: boolean;
  /** Status of the STT engine */
  sttStatus: VoiceEngineStatus;
  /** Status of the TTS engine */
  ttsStatus: VoiceEngineStatus;
  /** Status of the VAD engine */
  vadStatus: VoiceEngineStatus;
  /** Status of the wake-word engine */
  wakeWordStatus: VoiceEngineStatus;
  /** Currently active STT engine identifier */
  activeSttEngine: VoiceSttEngine | null;
  /** Currently active TTS engine identifier */
  activeTtsEngine: VoiceTtsEngine | null;
  /** Whether microphone permission has been granted */
  microphonePermission: 'prompt' | 'granted' | 'denied' | 'unknown';
  /** Whether the user has completed the voice onboarding */
  onboardingComplete: boolean;
  /** Timestamp of last voice activity */
  lastActivityAt: string | null;
  /** Current confidence score of last transcription (0-1) */
  lastConfidence: number;
  /** Whether dictation mode is active (continuous text insertion) */
  dictationActive: boolean;
}

const initialState: VoiceState = {
  mode: 'inactive',
  error: null,
  transcript: '',
  processing: false,
  sttStatus: 'idle',
  ttsStatus: 'idle',
  vadStatus: 'idle',
  wakeWordStatus: 'idle',
  activeSttEngine: null,
  activeTtsEngine: null,
  microphonePermission: 'unknown',
  onboardingComplete: false,
  lastActivityAt: null,
  lastConfidence: 0,
  dictationActive: false,
};

export const voiceSlice = createSlice({
  name: 'voice',
  initialState,
  reducers: {
    setVoiceMode: (state, action: PayloadAction<VoiceMode>) => {
      const next = action.payload;
      // QNBS-v3 (CodeAnt): a fresh listening cycle starts with no confidence — drop any prior
      // utterance's score at the source so the UI never shows a stale value before a new result
      // arrives. (Dictation starts via setDictationActive, not here — reset is handled there.)
      if (next === 'listening' && state.mode !== next) {
        state.lastConfidence = 0;
      }
      state.mode = next;
      if (next !== 'inactive') {
        state.lastActivityAt = new Date().toISOString();
      }
    },
    setVoiceError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      if (action.payload) {
        state.mode = 'inactive';
        state.processing = false;
      }
    },
    setVoiceTranscript: (state, action: PayloadAction<string>) => {
      state.transcript = action.payload;
    },
    appendVoiceTranscript: (state, action: PayloadAction<string>) => {
      state.transcript = state.transcript
        ? `${state.transcript} ${action.payload}`
        : action.payload;
    },
    setVoiceProcessing: (state, action: PayloadAction<boolean>) => {
      state.processing = action.payload;
    },
    setSttStatus: (state, action: PayloadAction<VoiceEngineStatus>) => {
      state.sttStatus = action.payload;
    },
    setTtsStatus: (state, action: PayloadAction<VoiceEngineStatus>) => {
      state.ttsStatus = action.payload;
    },
    setVadStatus: (state, action: PayloadAction<VoiceEngineStatus>) => {
      state.vadStatus = action.payload;
    },
    setWakeWordStatus: (state, action: PayloadAction<VoiceEngineStatus>) => {
      state.wakeWordStatus = action.payload;
    },
    setActiveSttEngine: (state, action: PayloadAction<VoiceSttEngine | null>) => {
      state.activeSttEngine = action.payload;
    },
    setActiveTtsEngine: (state, action: PayloadAction<VoiceTtsEngine | null>) => {
      state.activeTtsEngine = action.payload;
    },
    setMicrophonePermission: (
      state,
      action: PayloadAction<'prompt' | 'granted' | 'denied' | 'unknown'>,
    ) => {
      state.microphonePermission = action.payload;
    },
    setVoiceOnboardingComplete: (state, action: PayloadAction<boolean>) => {
      state.onboardingComplete = action.payload;
    },
    setLastConfidence: (state, action: PayloadAction<number>) => {
      state.lastConfidence = action.payload;
    },
    setDictationActive: (state, action: PayloadAction<boolean>) => {
      state.dictationActive = action.payload;
      if (action.payload) {
        // QNBS-v3 (CodeAnt): dictation starts here (not via setVoiceMode), so reset confidence here
        // too — a fresh dictation session must not surface a prior utterance's score.
        if (state.mode !== 'dictating') state.lastConfidence = 0;
        state.mode = 'dictating';
      } else if (state.mode === 'dictating') {
        state.mode = 'inactive';
      }
    },
    resetVoiceState: () => initialState,
  },
});

export const {
  setVoiceMode,
  setVoiceError,
  setVoiceTranscript,
  appendVoiceTranscript,
  setVoiceProcessing,
  setSttStatus,
  setTtsStatus,
  setVadStatus,
  setWakeWordStatus,
  setActiveSttEngine,
  setActiveTtsEngine,
  setMicrophonePermission,
  setVoiceOnboardingComplete,
  setLastConfidence,
  setDictationActive,
  resetVoiceState,
} = voiceSlice.actions;

export default voiceSlice.reducer;

// Selectors
export const selectVoiceState = (state: { voice: VoiceState }) => state.voice;
export const selectVoiceMode = (state: { voice: VoiceState }) => state.voice.mode;
export const selectIsVoiceListening = (state: { voice: VoiceState }) =>
  state.voice.mode === 'listening' || state.voice.mode === 'dictating';
export const selectVoiceError = (state: { voice: VoiceState }) => state.voice.error;
export const selectVoiceTranscript = (state: { voice: VoiceState }) => state.voice.transcript;
export const selectVoiceProcessing = (state: { voice: VoiceState }) => state.voice.processing;
export const selectSttStatus = (state: { voice: VoiceState }) => state.voice.sttStatus;
export const selectTtsStatus = (state: { voice: VoiceState }) => state.voice.ttsStatus;
export const selectVadStatus = (state: { voice: VoiceState }) => state.voice.vadStatus;
export const selectWakeWordStatus = (state: { voice: VoiceState }) => state.voice.wakeWordStatus;
export const selectMicrophonePermission = (state: { voice: VoiceState }) =>
  state.voice.microphonePermission;
export const selectDictationActive = (state: { voice: VoiceState }) => state.voice.dictationActive;
// QNBS-v3: PR5 — confidence of the last transcription (0-1), surfaced for voice feedback UI.
export const selectLastConfidence = (state: { voice: VoiceState }) => state.voice.lastConfidence;
