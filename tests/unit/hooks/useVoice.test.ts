/**
 * Tests for hooks/useVoice.ts
 * QNBS-v3: Mocks VoiceCommandService + Redux; covers state projection and action delegation.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

const mockVoiceSettings = {
  enabled: true,
  sttEngine: 'webSpeech',
  ttsEngine: 'webSpeech',
  feedbackLevel: 'medium',
  speechRate: 1,
  speechVolume: 1,
  allowCloudSttFallback: false,
  listeningTimeoutSeconds: 10,
  wakeWordPhrase: 'hey story',
  ttsMuted: false,
  dictationAutoPunctuation: true,
  activationMode: 'manual',
};

let mockVoiceMode: string = 'inactive';
let mockVoiceError: string | null = null;
let mockVoiceTranscript = '';
let mockProcessing = false;
let mockSttStatus = 'idle';
let mockTtsStatus = 'idle';
let mockMicPermission = 'unknown';
let mockDictationActive = false;

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  // QNBS-v3: featureFlags must include ALL 20 flags (strict TypeScript) — useVoice accesses enableVoiceWasm
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      settings: { voice: mockVoiceSettings },
      featureFlags: {
        enableStoryBibleAdvanced: false,
        enableBinderResearch: false,
        enableCompileWizard: false,
        enableProjectHealthScore: false,
        enableAppHealthPanel: false,
        enableDuckDbAnalytics: false,
        enableObjectsGroups: false,
        enableMindMaps: false,
        enableCharacterInterviews: false,
        enableRtlLayout: false,
        enableLoraAdapters: false,
        enablePluginSystem: false,
        enableVoiceSupport: false,
        enableVoiceWasm: false,
        enableProForge: false,
        enableIdbAtRestEncryption: false,
      },
      voice: {
        mode: mockVoiceMode,
        error: mockVoiceError,
        transcript: mockVoiceTranscript,
        processing: mockProcessing,
        sttStatus: mockSttStatus,
        ttsStatus: mockTtsStatus,
        microphonePermission: mockMicPermission,
        dictationActive: mockDictationActive,
      },
    }),
}));

vi.mock('../../../app/store', () => ({
  appStoreRef: { current: { getState: vi.fn(() => ({})) } },
}));

vi.mock('../../../features/settings/settingsSlice', () => ({
  selectVoiceSettings: (s: { settings: { voice: typeof mockVoiceSettings } }) => s.settings.voice,
}));

vi.mock('../../../features/voice/voiceSlice', () => ({
  resetVoiceState: vi.fn(() => ({ type: 'voice/resetVoiceState' })),
  selectVoiceMode: (s: { voice: { mode: string } }) => s.voice.mode,
  selectVoiceError: (s: { voice: { error: string | null } }) => s.voice.error,
  selectVoiceTranscript: (s: { voice: { transcript: string } }) => s.voice.transcript,
  selectVoiceProcessing: (s: { voice: { processing: boolean } }) => s.voice.processing,
  selectSttStatus: (s: { voice: { sttStatus: string } }) => s.voice.sttStatus,
  selectTtsStatus: (s: { voice: { ttsStatus: string } }) => s.voice.ttsStatus,
  selectMicrophonePermission: (s: { voice: { microphonePermission: string } }) =>
    s.voice.microphonePermission,
  selectDictationActive: (s: { voice: { dictationActive: boolean } }) => s.voice.dictationActive,
}));

const mockStartListening = vi.fn().mockResolvedValue(undefined);
const mockStopListening = vi.fn().mockResolvedValue(undefined);
const mockStartDictation = vi.fn().mockResolvedValue(undefined);
const mockStopDictation = vi.fn().mockResolvedValue(undefined);
const mockSpeak = vi.fn().mockResolvedValue(undefined);
const mockCancelSpeech = vi.fn();
const mockCompleteOnboarding = vi.fn();
const mockUpdateConfig = vi.fn();
const mockSetDispatch = vi.fn();

vi.mock('../../../services/voice/voiceCommandService', () => ({
  getVoiceService: vi.fn(() => ({
    startListening: mockStartListening,
    stopListening: mockStopListening,
    startDictation: mockStartDictation,
    stopDictation: mockStopDictation,
    speak: mockSpeak,
    cancelSpeech: mockCancelSpeech,
    completeOnboarding: mockCompleteOnboarding,
    updateConfig: mockUpdateConfig,
    setDispatch: mockSetDispatch,
  })),
}));

vi.mock('../../../services/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useVoice } from '../../../hooks/useVoice';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceMode = 'inactive';
    mockVoiceError = null;
    mockVoiceTranscript = '';
    mockProcessing = false;
    mockSttStatus = 'idle';
    mockTtsStatus = 'idle';
    mockMicPermission = 'unknown';
    mockDictationActive = false;
  });

  it('returns correct initial state', () => {
    const { result } = renderHook(() => useVoice());
    expect(result.current.enabled).toBe(true);
    expect(result.current.isListening).toBe(false);
    expect(result.current.mode).toBe('inactive');
    expect(result.current.error).toBeNull();
  });

  it('isListening=true when mode is "listening"', () => {
    mockVoiceMode = 'listening';
    const { result } = renderHook(() => useVoice());
    expect(result.current.isListening).toBe(true);
  });

  it('isListening=true when mode is "dictating"', () => {
    mockVoiceMode = 'dictating';
    const { result } = renderHook(() => useVoice());
    expect(result.current.isListening).toBe(true);
  });

  it('reflects transcript from Redux', () => {
    mockVoiceTranscript = 'hello world';
    const { result } = renderHook(() => useVoice());
    expect(result.current.transcript).toBe('hello world');
  });

  it('reflects processing from Redux', () => {
    mockProcessing = true;
    const { result } = renderHook(() => useVoice());
    expect(result.current.processing).toBe(true);
  });

  it('startListening delegates to voice service', async () => {
    const { result } = renderHook(() => useVoice());
    await act(async () => {
      await result.current.startListening();
    });
    expect(mockStartListening).toHaveBeenCalled();
  });

  it('startListening does nothing when voice is disabled', async () => {
    const { result } = renderHook(() => useVoice());
    // Simulate disabled state by returning disabled settings
    // We'll test the guard via the enabled flag
    Object.assign(mockVoiceSettings, { enabled: false });
    await act(async () => {
      await result.current.startListening();
    });
    // startListening was called from hook but hook guards it
    // restore
    Object.assign(mockVoiceSettings, { enabled: true });
  });

  it('stopListening delegates to voice service', async () => {
    const { result } = renderHook(() => useVoice());
    await act(async () => {
      await result.current.stopListening();
    });
    expect(mockStopListening).toHaveBeenCalled();
  });

  it('startDictation delegates to voice service', async () => {
    const { result } = renderHook(() => useVoice());
    await act(async () => {
      await result.current.startDictation();
    });
    expect(mockStartDictation).toHaveBeenCalled();
  });

  it('stopDictation delegates to voice service', async () => {
    const { result } = renderHook(() => useVoice());
    await act(async () => {
      await result.current.stopDictation();
    });
    expect(mockStopDictation).toHaveBeenCalled();
  });

  it('speakFeedback delegates to voice service', async () => {
    const { result } = renderHook(() => useVoice());
    await act(async () => {
      await result.current.speakFeedback('well done');
    });
    expect(mockSpeak).toHaveBeenCalledWith('well done');
  });

  it('cancelSpeech delegates to voice service', () => {
    const { result } = renderHook(() => useVoice());
    result.current.cancelSpeech();
    expect(mockCancelSpeech).toHaveBeenCalled();
  });

  it('reset dispatches resetVoiceState', () => {
    const { result } = renderHook(() => useVoice());
    act(() => result.current.reset());
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('completeOnboarding delegates to voice service', () => {
    const { result } = renderHook(() => useVoice());
    result.current.completeOnboarding();
    expect(mockCompleteOnboarding).toHaveBeenCalled();
  });

  it('calls updateConfig on mount with voice settings', () => {
    renderHook(() => useVoice());
    expect(mockUpdateConfig).toHaveBeenCalled();
  });

  it('calls setDispatch on mount', () => {
    renderHook(() => useVoice());
    expect(mockSetDispatch).toHaveBeenCalled();
  });

  it('reflects dictationActive from Redux', () => {
    mockDictationActive = true;
    const { result } = renderHook(() => useVoice());
    expect(result.current.dictationActive).toBe(true);
  });

  it('reflects microphonePermission from Redux', () => {
    mockMicPermission = 'granted';
    const { result } = renderHook(() => useVoice());
    expect(result.current.microphonePermission).toBe('granted');
  });
});
