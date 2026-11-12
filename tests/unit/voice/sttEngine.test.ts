import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConsentRequiredError,
  createSttEngine,
  LOCAL_STT_UNAVAILABLE_MESSAGE,
  WebSpeechSttEngine,
} from '../../../services/voice/sttEngine';
import type { SttResult } from '../../../services/voice/voiceTypes';

function createMockRecognition() {
  return {
    continuous: false,
    interimResults: false,
    lang: '',
    onresult: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onend: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
  };
}

describe('WebSpeechSttEngine', () => {
  let engine: WebSpeechSttEngine;

  beforeEach(() => {
    engine = new WebSpeechSttEngine();
  });

  it('reports availability based on browser support', async () => {
    vi.stubGlobal('window', {
      SpeechRecognition: vi.fn(),
    });
    expect(await engine.isAvailable()).toBe(true);
  });

  // QNBS-v3: SEC-4 — initialize() requires consent for cloud STT engines.
  it('throws ConsentRequiredError when initialized without consent', async () => {
    await expect(engine.initialize()).rejects.toThrow(ConsentRequiredError);
  });

  it('initializes successfully when consent is granted', async () => {
    const consentedEngine = new WebSpeechSttEngine(true);
    await expect(consentedEngine.initialize()).resolves.toBeUndefined();
  });

  it('starts recognition and routes results', async () => {
    const mockRecognition = createMockRecognition();

    // QNBS-v3: Must be a regular function (not arrow) to work as a `new` target.
    // biome-ignore lint/suspicious/noExplicitAny: test mock constructor
    const MockCtor = function (this: any) {
      return mockRecognition;
    } as unknown as new () => ReturnType<typeof createMockRecognition>;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    const onResult = vi.fn();
    const onError = vi.fn();

    await engine.start(onResult, onError);

    expect(mockRecognition.start).toHaveBeenCalled();
    expect(mockRecognition.continuous).toBe(true);
    expect(mockRecognition.interimResults).toBe(true);

    // Simulate final result
    const lastResult = [
      {
        transcript: 'hello world',
        confidence: 0.95,
      },
    ] as unknown as SpeechRecognitionAlternative;
    Object.defineProperty(lastResult, 'isFinal', { value: true });

    const resultEvent = {
      results: [lastResult],
    } as unknown as SpeechRecognitionEvent;
    mockRecognition.onresult?.(resultEvent);

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining<SttResult>({
        transcript: 'hello world',
        confidence: 0.95,
        isFinal: true,
      }),
    );
  });

  it('ignores no-speech and aborted errors', async () => {
    const mockRecognition = createMockRecognition();
    // biome-ignore lint/suspicious/noExplicitAny: test mock constructor
    const MockCtor = function (this: any) {
      return mockRecognition;
    } as unknown as new () => ReturnType<typeof createMockRecognition>;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    const onError = vi.fn();
    await engine.start(vi.fn(), onError);

    mockRecognition.onerror?.({ error: 'no-speech' });
    expect(onError).not.toHaveBeenCalled();

    mockRecognition.onerror?.({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('auto-restarts on unexpected end', async () => {
    const mockRecognition = createMockRecognition();
    // biome-ignore lint/suspicious/noExplicitAny: test mock constructor
    const MockCtor = function (this: any) {
      return mockRecognition;
    } as unknown as new () => ReturnType<typeof createMockRecognition>;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    await engine.start(vi.fn(), vi.fn());
    mockRecognition.onend?.();

    expect(mockRecognition.start).toHaveBeenCalledTimes(2);
  });

  it('stops recognition gracefully', async () => {
    const mockRecognition = createMockRecognition();
    // biome-ignore lint/suspicious/noExplicitAny: test mock constructor
    const MockCtor = function (this: any) {
      return mockRecognition;
    } as unknown as new () => ReturnType<typeof createMockRecognition>;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });

    await engine.start(vi.fn(), vi.fn());
    await engine.stop();

    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it('disposes and cleans up', async () => {
    await expect(engine.dispose()).resolves.toBeUndefined();
  });
});

describe('createSttEngine', () => {
  beforeEach(() => {
    const MockCtor = vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      continuous: false,
      interimResults: false,
      lang: '',
      onresult: null,
      onerror: null,
      onend: null,
    })) as unknown as new () => unknown;

    vi.stubGlobal('window', {
      SpeechRecognition: MockCtor,
    });
  });

  it('selects webSpeech engine by default', async () => {
    const engine = await createSttEngine();
    expect(engine.id).toBe('webSpeech');
  });

  // #1261: an explicit on-device choice used to fall back silently to Web Speech, which sends audio to the browser vendor.
  it('refuses to turn an explicit on-device choice into cloud recognition', async () => {
    await expect(createSttEngine({ preferredEngine: 'whisper' })).rejects.toThrow(
      LOCAL_STT_UNAVAILABLE_MESSAGE,
    );
  });

  it('falls back to Web Speech only when cloud fallback is allowed', async () => {
    const engine = await createSttEngine({ preferredEngine: 'whisper', allowCloudFallback: true });
    expect(engine.id).toBe('webSpeech');
  });

  describe('with the local-model engine enabled', () => {
    const wasmModule = '../../../services/voice/wasmSttEngine';
    afterEach(() => {
      vi.doUnmock(wasmModule);
      vi.resetModules();
    });

    it('uses the on-device engine when it loads and is available', async () => {
      vi.doMock(wasmModule, () => ({
        WasmSttEngine: class {
          readonly id = 'whisper';
          readonly name = 'Whisper (local)';
          isAvailable() {
            return Promise.resolve(true);
          }
        },
      }));
      const engine = await createSttEngine({ preferredEngine: 'whisper', enableVoiceWasm: true });
      expect(engine.id).toBe('whisper');
    });

    it('falls back to Web Speech for an auto choice when the on-device engine cannot load', async () => {
      vi.doMock(wasmModule, () => ({
        WasmSttEngine: class {
          constructor() {
            throw new Error('ONNX runtime unavailable');
          }
        },
      }));
      const engine = await createSttEngine({ enableVoiceWasm: true });
      expect(engine.id).toBe('webSpeech');
    });
  });

  it('reports that no engine is available when the browser has no speech recognition', async () => {
    vi.stubGlobal('window', {});
    await expect(createSttEngine()).rejects.toThrow('No STT engine available');
  });
});
