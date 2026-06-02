// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: bare-specifier mock — intercepts the engine's dynamic import('@huggingface/transformers').
const mockPipelineFactory = vi.fn();
vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipelineFactory,
  env: { backends: { onnx: { wasm: { proxy: true } } } },
}));

vi.mock('../../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { KokoroTtsEngine } from '../../../services/voice/kokoroTtsEngine';
import type { TtsUtterance } from '../../../services/voice/voiceTypes';

// ── Minimal Web Audio stubs ──────────────────────────────────────────────────
class MockBufferSource {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  connect = vi.fn();
  stop = vi.fn();
  // QNBS-v3: invoke onended synchronously so speak()'s playback promise resolves in the test.
  start = vi.fn(() => {
    this.onended?.();
  });
}
class MockGain {
  gain = { value: 1 };
  connect = vi.fn();
}
class MockAudioContext {
  destination = {};
  createBuffer = vi.fn((_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
  }));
  createBufferSource = vi.fn(() => new MockBufferSource());
  createGain = vi.fn(() => new MockGain());
  suspend = vi.fn();
  resume = vi.fn();
  close = vi.fn().mockResolvedValue(undefined);
}

beforeEach(() => {
  mockPipelineFactory.mockReset();
  vi.stubGlobal('AudioContext', MockAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KokoroTtsEngine', () => {
  it('isAvailable() true when WebAssembly + AudioContext + pipeline are present', async () => {
    expect(await new KokoroTtsEngine().isAvailable()).toBe(true);
  });

  it('isAvailable() false when AudioContext is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(await new KokoroTtsEngine().isAvailable()).toBe(false);
  });

  it('initialize() loads the onnx-community Kokoro model with dtype q8', async () => {
    mockPipelineFactory.mockResolvedValue(
      vi.fn().mockResolvedValue({ audio: new Float32Array(8), sampling_rate: 24000 }),
    );
    await new KokoroTtsEngine().initialize();
    expect(mockPipelineFactory).toHaveBeenCalledWith(
      'text-to-speech',
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      { dtype: 'q8' },
    );
  });

  it('speak() runs the TTS pipeline with a voice and resolves once playback ends', async () => {
    const ttsFn = vi.fn().mockResolvedValue({ audio: new Float32Array(16), sampling_rate: 24000 });
    mockPipelineFactory.mockResolvedValue(ttsFn);
    const engine = new KokoroTtsEngine();
    await engine.initialize();
    const utterance: TtsUtterance = { text: 'hello world', rate: 1, volume: 1 };
    await expect(engine.speak(utterance)).resolves.toBeUndefined();
    expect(ttsFn).toHaveBeenCalledWith('hello world', { voice: 'af_bella' });
  });

  it('speak() throws when the engine has not been initialized', async () => {
    await expect(new KokoroTtsEngine().speak({ text: 'x' })).rejects.toThrow(/not initialized/i);
  });

  it('reports id "kokoro" and isLocal true', () => {
    const engine = new KokoroTtsEngine();
    expect(engine.id).toBe('kokoro');
    expect(engine.isLocal).toBe(true);
  });

  it('isAvailable() false when WebAssembly is unavailable', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    expect(await new KokoroTtsEngine().isAvailable()).toBe(false);
  });

  it('cancel() is a no-op when nothing is playing', () => {
    expect(() => new KokoroTtsEngine().cancel()).not.toThrow();
  });

  it('cancel() stops an in-flight source', async () => {
    // QNBS-v3: a source whose start() does NOT auto-end, so currentSource stays live for cancel().
    const sources: MockBufferSource[] = [];
    class NonEndingSource extends MockBufferSource {
      override start = vi.fn();
    }
    class TrackingContext extends MockAudioContext {
      override createBufferSource = vi.fn(() => {
        const s = new NonEndingSource();
        sources.push(s);
        return s;
      });
    }
    vi.stubGlobal('AudioContext', TrackingContext);
    mockPipelineFactory.mockResolvedValue(
      vi.fn().mockResolvedValue({ audio: new Float32Array(8), sampling_rate: 24000 }),
    );
    const engine = new KokoroTtsEngine();
    await engine.initialize();
    void engine.speak({ text: 'hi' }); // never resolves (no onended) — intentionally not awaited
    await new Promise((r) => setTimeout(r, 0));
    engine.cancel();
    expect(sources.at(-1)?.stop).toHaveBeenCalled();
  });

  it('pause()/resume() and dispose() delegate to the AudioContext', async () => {
    const contexts: MockAudioContext[] = [];
    class TrackingContext extends MockAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    }
    vi.stubGlobal('AudioContext', TrackingContext);
    mockPipelineFactory.mockResolvedValue(
      vi.fn().mockResolvedValue({ audio: new Float32Array(8), sampling_rate: 24000 }),
    );
    const engine = new KokoroTtsEngine();
    await engine.initialize();
    await engine.speak({ text: 'hi' });
    const ctx = contexts.at(-1);
    engine.pause();
    engine.resume();
    expect(ctx?.suspend).toHaveBeenCalled();
    expect(ctx?.resume).toHaveBeenCalled();

    await engine.dispose();
    expect(ctx?.close).toHaveBeenCalled();
    // pipeline cleared on dispose → speak throws again
    await expect(engine.speak({ text: 'again' })).rejects.toThrow(/not initialized/i);
  });
});
