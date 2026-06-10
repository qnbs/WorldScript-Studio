/**
 * Tests for voiceCommandService.ts — downloadVoiceModels + processTranscript + intent paths.
 * QNBS-v3: Covers uncovered branches in the download pipeline and intent processing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mock references (vi.hoisted → safe to use in vi.mock factories) ───
const { mockSetVoiceSettings, mockPipeline, mockDispose, mockParse } = vi.hoisted(() => {
  const mockDispose = vi.fn();
  const mockPipeline = vi.fn().mockResolvedValue({ dispose: mockDispose });
  return {
    mockSetVoiceSettings: vi.fn(),
    mockPipeline,
    mockDispose,
    mockParse: vi.fn().mockReturnValue(null),
  };
});

// ── Shared mocks (must be before import) ──────────────────────────────────────

vi.mock('../../../../services/ai/ecoModeService', () => ({
  ecoModeService: { isEcoMode: () => false },
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
    confirm = vi.fn().mockResolvedValue(undefined);
    error = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../../../services/voice/intentEngine', () => ({
  HybridIntentEngine: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    parse = mockParse;
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
    id: 'webrtc',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../../services/voice/wakeWordEngine', () => ({
  createWakeWordEngine: vi.fn().mockResolvedValue({
    id: 'energy',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../../features/settings/settingsSlice', () => ({
  settingsActions: { setVoiceSettings: mockSetVoiceSettings },
}));

vi.mock('../../../../features/voice/voiceSlice', () => ({
  appendVoiceTranscript: vi.fn((t) => ({ type: 'voice/appendTranscript', payload: t })),
  setActiveSttEngine: vi.fn(),
  setActiveTtsEngine: vi.fn(),
  setDictationActive: vi.fn(),
  setLastConfidence: vi.fn(),
  setMicrophonePermission: vi.fn(),
  setSttStatus: vi.fn(),
  setTtsStatus: vi.fn(),
  setVadStatus: vi.fn(),
  setVoiceError: vi.fn((e) => ({ type: 'voice/error', payload: e })),
  setVoiceMode: vi.fn((m) => ({ type: 'voice/mode', payload: m })),
  setVoiceOnboardingComplete: vi.fn(),
  setVoiceTranscript: vi.fn(),
  setWakeWordStatus: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipeline,
  env: { backends: { onnx: { wasm: { proxy: true } } } },
}));

import { appendVoiceTranscript } from '../../../../features/voice/voiceSlice';
import { VoiceCommandService } from '../../../../services/voice/voiceCommandService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  const service = new VoiceCommandService({ enableVoiceWasm: true });
  const dispatched: unknown[] = [];
  service.setDispatch(
    ((action: unknown) => {
      dispatched.push(action);
      return action;
      // biome-ignore lint/suspicious/noExplicitAny: test dispatch shim
    }) as any,
    (() => ({
      settings: {
        voice: { feedbackLevel: 'standard', enabled: true },
      },
      project: {
        present: {
          data: {
            characters: { ids: [], entities: {} },
            manuscript: [],
            worlds: { ids: [], entities: {} },
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: test getState shim
    })) as any,
  );
  return { service, dispatched };
}

// ── Tests: downloadVoiceModels ─────────────────────────────────────────────────

describe('downloadVoiceModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-register the default mock after clearAllMocks resets it
    mockPipeline.mockResolvedValue({ dispose: mockDispose });
  });

  it('happy path: dispatches progress 0.1 then 1.0 + wasmModelsReady=true', async () => {
    const { service } = makeService();
    await service.downloadVoiceModels('stt');

    expect(mockSetVoiceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ wasmModelDownloadProgress: 0.1 }),
    );
    expect(mockSetVoiceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ wasmModelDownloadProgress: 1.0, wasmModelsReady: true }),
    );
  });

  it('happy path: calls dispose() on the pipeline after download', async () => {
    const { service } = makeService();
    await service.downloadVoiceModels('stt');
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('pre-aborted signal: returns immediately without dispatching', async () => {
    const { service } = makeService();
    const controller = new AbortController();
    controller.abort();
    await service.downloadVoiceModels('stt', controller.signal);
    expect(mockPipeline).not.toHaveBeenCalled();
    expect(mockSetVoiceSettings).not.toHaveBeenCalled();
  });

  it('aborted mid-download: disposes pipeline and does not set wasmModelsReady', async () => {
    const controller = new AbortController();
    // Abort as pipeline resolves
    mockPipeline.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ dispose: mockDispose });
    });
    const { service } = makeService();
    await service.downloadVoiceModels('stt', controller.signal);
    // Abort happened: final setVoiceSettings(wasmModelsReady:true) should NOT have been called
    const readyCalls = vi
      .mocked(mockSetVoiceSettings)
      .mock.calls.filter(([arg]) => arg?.wasmModelsReady === true);
    expect(readyCalls).toHaveLength(0);
    expect(mockDispose).toHaveBeenCalledTimes(1); // dispose called even on abort
  });

  it('error path: dispatches voiceWasmDownloadError and re-throws', async () => {
    const error = new Error('Network failure');
    mockPipeline.mockRejectedValue(error);
    const { service } = makeService();
    await expect(service.downloadVoiceModels('stt')).rejects.toThrow('Network failure');
    expect(mockSetVoiceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ voiceWasmDownloadError: 'Network failure' }),
    );
  });

  it('tts download uses kokoro model id', async () => {
    const { service } = makeService();
    await service.downloadVoiceModels('tts');
    expect(mockPipeline).toHaveBeenCalledWith(
      'text-to-speech',
      'onnxruntime-community/kokoro',
      expect.anything(),
    );
  });
});

// ── Tests: downloadVoiceModels — simulated (E2E test seam) ──────────────────────

describe('downloadVoiceModels — simulated (E2E seam)', () => {
  type HarnessWindow = { __voiceTestHarness?: unknown };
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as HarnessWindow).__voiceTestHarness;
  });
  afterEach(() => {
    delete (window as HarnessWindow).__voiceTestHarness;
  });

  it('success mode: marks ready and never calls the real pipeline', async () => {
    (window as HarnessWindow).__voiceTestHarness = {
      download: { mode: 'success', steps: 2, stepDelayMs: 0 },
    };
    const { service } = makeService();
    await service.downloadVoiceModels('stt');
    expect(mockPipeline).not.toHaveBeenCalled();
    expect(mockSetVoiceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ wasmModelDownloadProgress: 1.0, wasmModelsReady: true }),
    );
  });

  it('error mode: dispatches voiceWasmDownloadError and throws', async () => {
    (window as HarnessWindow).__voiceTestHarness = {
      download: { mode: 'error', steps: 1, stepDelayMs: 0, errorMessage: 'boom' },
    };
    const { service } = makeService();
    await expect(service.downloadVoiceModels('stt')).rejects.toThrow('boom');
    expect(mockPipeline).not.toHaveBeenCalled();
    expect(mockSetVoiceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ voiceWasmDownloadError: 'boom' }),
    );
  });

  it('pre-aborted signal: returns early without marking ready', async () => {
    (window as HarnessWindow).__voiceTestHarness = {
      download: { mode: 'success', steps: 5, stepDelayMs: 5 },
    };
    const controller = new AbortController();
    controller.abort();
    const { service } = makeService();
    await service.downloadVoiceModels('stt', controller.signal);
    const readyCalls = vi
      .mocked(mockSetVoiceSettings)
      .mock.calls.filter(([arg]) => arg?.wasmModelsReady === true);
    expect(readyCalls).toHaveLength(0);
  });
});

// ── Tests: handleDictationResult ──────────────────────────────────────────────

describe('handleDictationResult via startDictation callback', () => {
  it('dispatches appendVoiceTranscript for non-blank transcript', () => {
    const { service, dispatched } = makeService();
    // Access private via cast to test-friendly any
    (
      service as unknown as { handleDictationResult: (r: { transcript: string }) => void }
    ).handleDictationResult({ transcript: 'Hello world' });
    const appended = dispatched.find(
      (a) => (a as { type: string }).type === 'voice/appendTranscript',
    );
    expect(appended).toBeDefined();
    expect(appendVoiceTranscript).toHaveBeenCalledWith('Hello world');
  });

  it('does NOT dispatch for blank/whitespace transcript', () => {
    const { service, dispatched } = makeService();
    (
      service as unknown as { handleDictationResult: (r: { transcript: string }) => void }
    ).handleDictationResult({ transcript: '   ' });
    expect(dispatched).toHaveLength(0);
  });
});

// ── Tests: startListening single-flight guard (C-P1) ───────────────────────────

describe('startListening single-flight guard', () => {
  type PrivateState = { listeningTimer: ReturnType<typeof setTimeout> | null; isStarting: boolean };
  it('returns early when listening is already active (listeningTimer set)', async () => {
    const { service } = makeService();
    const initSpy = vi.spyOn(service, 'initialize');
    const priv = service as unknown as PrivateState;
    priv.listeningTimer = setTimeout(() => {}, 10_000);
    await service.startListening();
    expect(initSpy).not.toHaveBeenCalled();
    if (priv.listeningTimer) clearTimeout(priv.listeningTimer);
  });

  it('returns early when a start is already in flight (isStarting)', async () => {
    const { service } = makeService();
    const initSpy = vi.spyOn(service, 'initialize');
    (service as unknown as PrivateState).isStarting = true;
    await service.startListening();
    expect(initSpy).not.toHaveBeenCalled();
  });
});

// ── Tests: processTranscript ──────────────────────────────────────────────────

describe('processTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window dispatchEvent spy
    vi.spyOn(window, 'dispatchEvent');
  });

  it('calls feedbackService.error when intent not recognized', async () => {
    mockParse.mockReturnValue(null);
    const { service } = makeService();
    const feedbackService = (
      service as unknown as {
        feedbackService: { error: ReturnType<typeof vi.fn> };
      }
    ).feedbackService;
    await (
      service as unknown as { processTranscript: (t: string) => Promise<void> }
    ).processTranscript('gibberish command');
    expect(feedbackService.error).toHaveBeenCalledWith(
      expect.stringContaining("didn't understand"),
    );
  });

  it('dispatches voice-command CustomEvent when intent recognized', async () => {
    mockParse.mockReturnValue({
      commandId: 'cmd.newProject',
      slots: {},
      transcript: 'new project',
    });
    const { service } = makeService();
    await (
      service as unknown as { processTranscript: (t: string) => Promise<void> }
    ).processTranscript('new project');
    const eventSpy = vi.mocked(window.dispatchEvent);
    expect(eventSpy).toHaveBeenCalled();
    const fired = eventSpy.mock.calls[0]?.[0] as CustomEvent;
    expect(fired.type).toBe('voice-command');
    expect((fired as CustomEvent<{ commandId: string }>).detail.commandId).toBe('cmd.newProject');
  });
});
