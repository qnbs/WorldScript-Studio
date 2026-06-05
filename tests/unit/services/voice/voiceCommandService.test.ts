/**
 * Tests for voiceCommandService.ts — Voice service lifecycle and event handling.
 * QNBS-v3: P1 tests for uncovered code paths.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../../../services/ai/ecoModeService', () => ({
  ecoModeService: {
    isEcoMode: () => false,
  },
}));

vi.mock('../../../../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../services/voice/feedbackService', () => ({
  FeedbackService: class {
    setFeedbackLevel = vi.fn();
    setMuted = vi.fn();
    setTtsEngine = vi.fn();
    cancel = vi.fn();
  },
}));

vi.mock('../../../../services/voice/intentEngine', () => ({
  HybridIntentEngine: class {
    initialize = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../../../services/voice/sttEngine', () => ({
  createSttEngine: vi.fn().mockResolvedValue({
    id: 'webspeech',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../../services/voice/ttsEngine', () => ({
  createTtsEngine: vi.fn().mockResolvedValue({
    id: 'webspeech',
    speak: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../../services/voice/vadEngine', () => ({
  createVadEngine: vi.fn().mockResolvedValue({
    id: 'webspeech',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../../services/voice/wakeWordEngine', () => ({
  createWakeWordEngine: vi.fn().mockResolvedValue({
    id: 'webspeech',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock Redux actions
vi.mock('../../../../features/voice/voiceSlice', () => ({
  appendVoiceTranscript: vi.fn(),
  setActiveSttEngine: vi.fn(),
  setActiveTtsEngine: vi.fn(),
  setDictationActive: vi.fn(),
  setLastConfidence: vi.fn(),
  setMicrophonePermission: vi.fn(),
  setSttStatus: vi.fn(),
  setTtsStatus: vi.fn(),
  setVadStatus: vi.fn(),
  setVoiceError: vi.fn(),
  setVoiceMode: vi.fn(),
  setVoiceOnboardingComplete: vi.fn(),
  setVoiceTranscript: vi.fn(),
  setWakeWordStatus: vi.fn(),
}));

import { VoiceCommandService } from '../../../../services/voice/voiceCommandService';

describe('VoiceCommandService', () => {
  let service: VoiceCommandService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VoiceCommandService({ enableVoiceWasm: false });
  });

  describe('addEventListener', () => {
    it('adds and removes event listeners', () => {
      const listener = vi.fn();
      const unsubscribe = service.addEventListener(listener);
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('setDispatch', () => {
    it('sets dispatch and getState functions', () => {
      const mockDispatch = vi.fn();
      const mockGetState = vi.fn();
      service.setDispatch(mockDispatch as never, mockGetState as never);
      // Should not throw
      expect(() => service.setDispatch(mockDispatch as never, mockGetState as never)).not.toThrow();
    });
  });

  describe('initialize', () => {
    it('returns true when initialization succeeds', async () => {
      // Mock mediaDevices for permission
      Object.defineProperty(global.navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [{ stop: vi.fn() }],
          }),
        },
        writable: true,
        configurable: true,
      });

      const result = await service.initialize();
      expect(result).toBe(true);
    });
  });

  describe('startListening', () => {
    it('throws error when not initialized and init fails', async () => {
      const failingService = new VoiceCommandService();
      // Mock initialize to return false (no mic permission)
      const originalInitialize = failingService.initialize;
      failingService.initialize = vi.fn().mockResolvedValue(false);

      await expect(failingService.startListening()).rejects.toThrow(
        'Voice service could not be initialized',
      );
      failingService.initialize = originalInitialize;
    });
  });

  describe('startDictation', () => {
    it('throws error when not initialized and init fails', async () => {
      const failingService = new VoiceCommandService();
      failingService.initialize = vi.fn().mockResolvedValue(false);

      await expect(failingService.startDictation()).rejects.toThrow(
        'Voice service could not be initialized',
      );
    });
  });

  describe('stopListening', () => {
    it('stops listening and clears timer', async () => {
      await service.initialize();
      // Mock STT engine
      const mockSttEngine = {
        id: 'test',
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      };
      // biome-ignore lint/suspicious/noExplicitAny: accessing private property for test
      (service as any).sttEngine = mockSttEngine;

      await service.stopListening();
      expect(mockSttEngine.stop).toHaveBeenCalled();
    });
  });

  describe('speak', () => {
    it('speaks text via TTS engine', async () => {
      await service.initialize();
      const speakSpy = vi.fn().mockResolvedValue(undefined);
      // biome-ignore lint/suspicious/noExplicitAny: accessing private property for test
      (service as any).ttsEngine = {
        id: 'test',
        speak: speakSpy,
        stop: vi.fn(),
        cancel: vi.fn(),
        dispose: vi.fn(),
      };

      await service.speak('Hello world');
      expect(speakSpy).toHaveBeenCalledWith({
        text: 'Hello world',
        rate: 1,
        volume: 1,
      });
    });
  });

  describe('dispose', () => {
    it('disposes all engines', async () => {
      await service.initialize();
      const disposeSpies = {
        stt: vi.fn().mockResolvedValue(undefined),
        tts: vi.fn().mockResolvedValue(undefined),
        vad: vi.fn().mockResolvedValue(undefined),
        wake: vi.fn().mockResolvedValue(undefined),
      };

      service['sttEngine'] = {
        id: 'test',
        start: vi.fn(),
        stop: vi.fn(),
        dispose: disposeSpies.stt,
      } as never;
      service['ttsEngine'] = {
        id: 'test',
        speak: vi.fn(),
        stop: vi.fn(),
        cancel: vi.fn(),
        dispose: disposeSpies.tts,
      } as never;
      service['vadEngine'] = {
        id: 'test',
        start: vi.fn(),
        stop: vi.fn(),
        dispose: disposeSpies.vad,
      } as never;
      service['wakeWordEngine'] = {
        id: 'test',
        start: vi.fn(),
        stop: vi.fn(),
        dispose: disposeSpies.wake,
      } as never;

      await service.dispose();
      expect(disposeSpies.stt).toHaveBeenCalled();
      expect(disposeSpies.tts).toHaveBeenCalled();
      expect(disposeSpies.vad).toHaveBeenCalled();
      expect(disposeSpies.wake).toHaveBeenCalled();
    });
  });
});
