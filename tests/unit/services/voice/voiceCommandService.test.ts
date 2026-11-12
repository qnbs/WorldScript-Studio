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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), withContext: vi.fn() }),
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

// QNBS-v3 (#333 item 1): mock the pipeline factory downloadVoiceModels() calls to trigger the
// model download — lets tests drive its onProgress callback with representative payloads.
const { mockPipeline } = vi.hoisted(() => ({ mockPipeline: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipeline,
  env: { backends: { onnx: { wasm: {} } } },
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

    // #556: a failed start (the Whisper model cannot load offline) left dictation shown as active, with no error.
    it('rolls back dictation and reports the error when the engine fails to start', async () => {
      const voiceSlice = await import('../../../../features/voice/voiceSlice');
      service.setDispatch(vi.fn() as never, vi.fn() as never);
      service['isInitialized'] = true;
      service['sttEngine'] = {
        id: 'whisper',
        start: vi.fn().mockRejectedValue(new Error('model fetch failed')),
        stop: vi.fn(),
        dispose: vi.fn(),
      } as never;

      await expect(service.startDictation()).rejects.toThrow('model fetch failed');
      expect(voiceSlice.setVoiceTranscript).toHaveBeenCalledWith('');
      expect(voiceSlice.setDictationActive).toHaveBeenLastCalledWith(false);
      expect(voiceSlice.setVoiceError).toHaveBeenLastCalledWith('model fetch failed');
    });

    // #556 review: dictation and command listening share one STT engine; only one may run it.
    function recordingEngine(order: string[], stop: () => Promise<void> = async () => {}) {
      service.setDispatch(vi.fn() as never, vi.fn() as never);
      service['isInitialized'] = true;
      service['sttEngine'] = {
        id: 'whisper',
        start: vi.fn(async () => {
          order.push('start');
        }),
        stop: vi.fn(async () => {
          order.push('stop');
          await stop();
        }),
        dispose: vi.fn(),
      } as never;
    }

    it('dictation ends command listening before it starts the engine', async () => {
      const order: string[] = [];
      recordingEngine(order);
      service['coordinator'] = {
        stop: vi.fn(async () => {
          order.push('coordinator.stop');
        }),
      } as never;
      await service.startDictation();
      expect(order).toEqual(['coordinator.stop', 'start']);
    });

    it('listening ends a running dictation first', async () => {
      const order: string[] = [];
      recordingEngine(order);
      await service.startDictation();
      await service.startListening();
      expect(order).toEqual(['start', 'stop', 'start']);
      await service.stopListening();
    });

    it('stopping dictation through stopListening lets dictation start again', async () => {
      const order: string[] = [];
      recordingEngine(order);
      await service.startDictation();
      await service.stopListening();
      await service.startDictation();
      expect(order).toEqual(['start', 'stop', 'start']);
    });

    it('two concurrent dictation starts start the engine once', async () => {
      const order: string[] = [];
      recordingEngine(order);
      await Promise.all([service.startDictation(), service.startDictation()]);
      expect(order).toEqual(['start']);
    });

    it('a dictation start waits for an in-flight listening start, then takes the engine over', async () => {
      const order: string[] = [];
      let finishListening!: () => void;
      const listening = new Promise<void>((resolve) => {
        finishListening = resolve;
      });
      let starts = 0;
      service.setDispatch(vi.fn() as never, vi.fn() as never);
      service['isInitialized'] = true;
      service['sttEngine'] = {
        id: 'webSpeech',
        start: vi.fn(async () => {
          starts += 1;
          order.push(starts === 1 ? 'listen.start' : 'dictation.start');
          if (starts === 1) await listening;
        }),
        stop: vi.fn(async () => {
          order.push('stop');
        }),
        dispose: vi.fn(),
      } as never;
      const listen = service.startListening();
      const dictate = service.startDictation();
      await Promise.resolve();
      finishListening();
      await Promise.all([listen, dictate]);
      expect(order).toEqual(['listen.start', 'stop', 'dictation.start']);
      await service.stopListening();
    });

    it('a second stopDictation waits for the drain of the first', async () => {
      const voiceSlice = await import('../../../../features/voice/voiceSlice');
      let finishDrain!: () => void;
      const drained = new Promise<void>((resolve) => {
        finishDrain = resolve;
      });
      let stops = 0;
      service.setDispatch(vi.fn() as never, vi.fn() as never);
      service['isInitialized'] = true;
      // Like the Whisper engine: only the first stop has a session to drain.
      service['sttEngine'] = {
        id: 'whisper',
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(async () => {
          stops += 1;
          if (stops === 1) await drained;
        }),
        dispose: vi.fn(),
      } as never;
      await service.startDictation();
      vi.mocked(voiceSlice.setDictationActive).mockClear();
      const first = service.stopDictation();
      let secondDone = false;
      const second = service.stopDictation().then(() => {
        secondDone = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(secondDone).toBe(false);
      expect(voiceSlice.setDictationActive).not.toHaveBeenCalled();
      finishDrain();
      await Promise.all([first, second]);
      expect(voiceSlice.setDictationActive).toHaveBeenCalledTimes(1);
    });

    it('stopDictation keeps dictation active until the engine has drained its last window', async () => {
      const voiceSlice = await import('../../../../features/voice/voiceSlice');
      let finishStop!: () => void;
      const drained = new Promise<void>((resolve) => {
        finishStop = resolve;
      });
      recordingEngine([], () => drained);
      await service.startDictation();
      vi.mocked(voiceSlice.setDictationActive).mockClear();
      const stopping = service.stopDictation();
      await Promise.resolve();
      expect(voiceSlice.setDictationActive).not.toHaveBeenCalled();
      finishStop();
      await stopping;
      expect(voiceSlice.setDictationActive).toHaveBeenCalledWith(false);
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

  // QNBS-v3 (#333 item 1): transformers.js's own progress payload is
  // `{ progress: <0-100>, loaded: <bytes>, total: <bytes> }` (verified against its readResponse()
  // source — progress = loaded/total*100). The prior code treated `progress` as if it were already
  // a 0-1 fraction, so `Math.min(0.95, pct)` clamped to 0.95 almost immediately (any progress value
  // over 0.95%), making the download bar look stuck. These tests pin the fixed 0-1 conversion and
  // the new real byte-count threading.
  describe('downloadVoiceModels', () => {
    let dispatch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      dispatch = vi.fn();
      service.setDispatch(dispatch as never, vi.fn() as never);
      mockPipeline.mockReset();
    });

    it('derives a 0-1 progress fraction from loaded/total bytes, not the raw 0-100 percent field', async () => {
      mockPipeline.mockImplementation(async (_task: string, _model: string, opts: unknown) => {
        const { onProgress } = opts as { onProgress: (p: unknown) => void };
        onProgress({ progress: 20, loaded: 8_400_000, total: 42_000_000 });
        return { dispose: vi.fn() };
      });

      await service.downloadVoiceModels('stt');

      const progressCalls = dispatch.mock.calls
        .map((c) => c[0])
        .filter(
          (a): a is { payload: { wasmModelDownloadProgress?: number } } =>
            typeof (a as { payload?: { wasmModelDownloadProgress?: number } })?.payload
              ?.wasmModelDownloadProgress === 'number',
        );
      // 8.4M / 42M = 0.2 — well under the 0.95 clamp, not stuck at 0.95 from a single early tick.
      expect(progressCalls.some((a) => a.payload.wasmModelDownloadProgress === 0.2)).toBe(true);
    });

    it('threads real loadedBytes/totalBytes from the progress payload into Redux', async () => {
      mockPipeline.mockImplementation(async (_task: string, _model: string, opts: unknown) => {
        const { onProgress } = opts as { onProgress: (p: unknown) => void };
        onProgress({ progress: 50, loaded: 21_000_000, total: 42_000_000 });
        return { dispose: vi.fn() };
      });

      await service.downloadVoiceModels('stt');

      const byteCall = dispatch.mock.calls
        .map((c) => c[0])
        .find(
          (a): a is { payload: { wasmModelDownloadLoadedBytes?: number } } =>
            typeof (a as { payload?: { wasmModelDownloadLoadedBytes?: number } })?.payload
              ?.wasmModelDownloadLoadedBytes === 'number',
        );
      expect(byteCall?.payload.wasmModelDownloadLoadedBytes).toBe(21_000_000);
      expect(
        (byteCall as unknown as { payload: { wasmModelDownloadTotalBytes: number } }).payload
          .wasmModelDownloadTotalBytes,
      ).toBe(42_000_000);
    });

    it('falls back to progress/100 when the payload has no loaded/total (defensive, not the normal path)', async () => {
      mockPipeline.mockImplementation(async (_task: string, _model: string, opts: unknown) => {
        const { onProgress } = opts as { onProgress: (p: unknown) => void };
        onProgress({ progress: 30 });
        return { dispose: vi.fn() };
      });

      await service.downloadVoiceModels('stt');

      const progressCalls = dispatch.mock.calls
        .map((c) => c[0])
        .filter(
          (a): a is { payload: { wasmModelDownloadProgress?: number } } =>
            typeof (a as { payload?: { wasmModelDownloadProgress?: number } })?.payload
              ?.wasmModelDownloadProgress === 'number',
        );
      expect(progressCalls.some((a) => a.payload.wasmModelDownloadProgress === 0.3)).toBe(true);
    });

    // QNBS-v3 (#333/CodeAnt+Qodo+CodeRabbit): byte fields must be explicitly cleared at every
    // lifecycle boundary — setVoiceSettings merges partial state, so an omitted key would leave a
    // prior attempt's bytes visible until the next byte-bearing progress tick arrives.
    it('clears stale byte counts from a previous attempt at the start of a new download', async () => {
      mockPipeline.mockImplementation(async (_task: string, _model: string, opts: unknown) => {
        const { onProgress } = opts as { onProgress: (p: unknown) => void };
        onProgress({ progress: 10, loaded: 1, total: 10 });
        return { dispose: vi.fn() };
      });

      await service.downloadVoiceModels('stt');

      const initialCall = dispatch.mock.calls
        .map((c) => c[0])
        .find(
          (a) =>
            (a as { payload?: { wasmModelDownloadProgress?: number } })?.payload
              ?.wasmModelDownloadProgress === 0.1,
        ) as { payload: Record<string, unknown> } | undefined;
      expect(initialCall).toBeDefined();
      expect(initialCall?.payload).toHaveProperty('wasmModelDownloadLoadedBytes');
      expect(initialCall?.payload['wasmModelDownloadLoadedBytes']).toBeUndefined();
      expect(initialCall?.payload).toHaveProperty('wasmModelDownloadTotalBytes');
      expect(initialCall?.payload['wasmModelDownloadTotalBytes']).toBeUndefined();
    });

    it('clears byte counts on successful completion', async () => {
      mockPipeline.mockImplementation(async (_task: string, _model: string, opts: unknown) => {
        const { onProgress } = opts as { onProgress: (p: unknown) => void };
        onProgress({ progress: 50, loaded: 21_000_000, total: 42_000_000 });
        return { dispose: vi.fn() };
      });

      await service.downloadVoiceModels('stt');

      const completeCall = dispatch.mock.calls
        .map((c) => c[0])
        .find(
          (a) =>
            (a as { payload?: { wasmModelDownloadProgress?: number } })?.payload
              ?.wasmModelDownloadProgress === 1.0,
        ) as { payload: Record<string, unknown> } | undefined;
      expect(completeCall).toBeDefined();
      expect(completeCall?.payload).toHaveProperty('wasmModelDownloadLoadedBytes');
      expect(completeCall?.payload['wasmModelDownloadLoadedBytes']).toBeUndefined();
      expect(completeCall?.payload).toHaveProperty('wasmModelDownloadTotalBytes');
      expect(completeCall?.payload['wasmModelDownloadTotalBytes']).toBeUndefined();
    });

    it('clears byte counts when the download fails', async () => {
      mockPipeline.mockImplementation(async (_task: string, _model: string, opts: unknown) => {
        const { onProgress } = opts as { onProgress: (p: unknown) => void };
        onProgress({ progress: 50, loaded: 21_000_000, total: 42_000_000 });
        throw new Error('network error');
      });

      await expect(service.downloadVoiceModels('stt')).rejects.toThrow('network error');

      const errorCall = dispatch.mock.calls
        .map((c) => c[0])
        .find(
          (a) =>
            (a as { payload?: { voiceWasmDownloadError?: string } })?.payload
              ?.voiceWasmDownloadError === 'network error',
        ) as { payload: Record<string, unknown> } | undefined;
      expect(errorCall).toBeDefined();
      expect(errorCall?.payload).toHaveProperty('wasmModelDownloadLoadedBytes');
      expect(errorCall?.payload['wasmModelDownloadLoadedBytes']).toBeUndefined();
      expect(errorCall?.payload).toHaveProperty('wasmModelDownloadTotalBytes');
      expect(errorCall?.payload['wasmModelDownloadTotalBytes']).toBeUndefined();
    });
  });
});
