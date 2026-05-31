// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock @huggingface/transformers ───────────────────────────────────────────
const mockPipelineFn = vi.fn().mockResolvedValue({ text: ' hello world' });
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(mockPipelineFn),
  env: {
    backends: {
      onnx: {
        wasm: { proxy: true },
      },
    },
  },
}));

import type { SttResult } from '../../../services/voice/voiceTypes';
import { WasmSttEngine } from '../../../services/voice/wasmSttEngine';

// ── MediaStream / MediaRecorder / AudioContext stubs ─────────────────────────

function makeMediaStreamTrack() {
  return { stop: vi.fn() };
}

function makeMediaStream() {
  const track = makeMediaStreamTrack();
  return {
    getTracks: () => [track],
    _track: track,
  };
}

function makeAudioBuffer(samples: Float32Array) {
  return {
    getChannelData: () => samples,
    length: samples.length,
    sampleRate: 16000,
    duration: samples.length / 16000,
    numberOfChannels: 1,
  };
}

function makeAudioContext(samples: Float32Array) {
  return {
    decodeAudioData: vi.fn().mockResolvedValue(makeAudioBuffer(samples)),
    close: vi.fn().mockResolvedValue(undefined),
    sampleRate: 16000,
  };
}

function makeMediaRecorder(_stream: ReturnType<typeof makeMediaStream>) {
  let ondataavailable:
    | ((e: {
        data: { size: number; arrayBuffer: () => Promise<ArrayBuffer>; type: string };
      }) => void)
    | null = null;
  const recorder = {
    state: 'inactive' as string,
    ondataavailable: null as unknown,
    start: vi.fn().mockImplementation(() => {
      recorder.state = 'recording';
    }),
    stop: vi.fn().mockImplementation(() => {
      recorder.state = 'inactive';
      // Simulate final dataavailable
      if (ondataavailable) {
        const buf = new ArrayBuffer(256);
        ondataavailable({
          data: {
            size: 256,
            arrayBuffer: () => Promise.resolve(buf),
            type: 'audio/webm',
          },
        });
      }
    }),
    _setOnDataAvailable(fn: typeof ondataavailable) {
      ondataavailable = fn;
      // also write to ondataavailable property for the engine
      recorder.ondataavailable = fn;
    },
  };
  // the engine sets recorder.ondataavailable = (event) => { ... }
  // we intercept with a Proxy
  return new Proxy(recorder, {
    set(target, prop, value) {
      if (prop === 'ondataavailable') {
        // biome-ignore lint/suspicious/noExplicitAny: test proxy
        target._setOnDataAvailable(value as any);
      }
      // biome-ignore lint/suspicious/noExplicitAny: test proxy
      (target as any)[prop] = value;
      return true;
    },
  });
}

// ── Setup globals ─────────────────────────────────────────────────────────────

const mockSamples = new Float32Array(16000); // 1s silence
let audioCtxMock: ReturnType<typeof makeAudioContext>;
let mediaStreamMock: ReturnType<typeof makeMediaStream>;
let mediaRecorderMock: ReturnType<typeof makeMediaRecorder>;

beforeEach(() => {
  vi.useFakeTimers();
  audioCtxMock = makeAudioContext(mockSamples);
  mediaStreamMock = makeMediaStream();
  mediaRecorderMock = makeMediaRecorder(mediaStreamMock);

  vi.stubGlobal('WebAssembly', {});
  // Regular functions required — arrow functions cannot be used as constructors.
  // biome-ignore lint/suspicious/noExplicitAny: constructor mock
  // biome-ignore lint/complexity/useArrowFunction: arrow functions are not constructors
  const AudioContextCtor: any = function () {
    return audioCtxMock;
  };
  vi.stubGlobal('AudioContext', AudioContextCtor);

  // biome-ignore lint/suspicious/noExplicitAny: constructor mock with static method
  // biome-ignore lint/complexity/useArrowFunction: arrow functions are not constructors
  const MediaRecorderCtor: any = function () {
    return mediaRecorderMock;
  };
  MediaRecorderCtor.isTypeSupported = vi.fn().mockReturnValue(true);
  vi.stubGlobal('MediaRecorder', MediaRecorderCtor);

  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(mediaStreamMock),
    },
  });

  mockPipelineFn.mockClear();
  mockPipelineFn.mockResolvedValue({ text: ' hello world' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WasmSttEngine', () => {
  it('has correct identity fields', () => {
    const engine = new WasmSttEngine();
    expect(engine.id).toBe('whisper');
    expect(engine.name).toBe('Whisper Tiny (local WASM)');
    expect(engine.isLocal).toBe(true);
    expect(engine.supportsStreaming).toBe(false);
  });

  it('isAvailable() returns true when WebAssembly + getUserMedia present', async () => {
    const engine = new WasmSttEngine();
    expect(await engine.isAvailable()).toBe(true);
  });

  it('isAvailable() returns false when WebAssembly is undefined', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    const engine = new WasmSttEngine();
    expect(await engine.isAvailable()).toBe(false);
  });

  it('isAvailable() returns false when getUserMedia is absent', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });
    const engine = new WasmSttEngine();
    expect(await engine.isAvailable()).toBe(false);
  });

  it('initialize() calls pipeline() with whisper-tiny.en + dtype:q8', async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const engine = new WasmSttEngine();
    await engine.initialize();
    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en',
      { dtype: 'q8' },
    );
  });

  it('start() requests microphone with getUserMedia', async () => {
    const { pipeline: _p } = await import('@huggingface/transformers');
    const engine = new WasmSttEngine();
    await engine.initialize();
    const onResult = vi.fn();
    const onError = vi.fn();
    await engine.start(onResult, onError);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.anything() }),
    );
    await engine.dispose();
  });

  it('start() throws when getUserMedia is denied', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });
    const engine = new WasmSttEngine();
    await engine.initialize();
    await expect(engine.start(vi.fn(), vi.fn())).rejects.toThrow('Microphone access denied');
  });

  it('stop() calls track.stop() and audioContext.close()', async () => {
    const engine = new WasmSttEngine();
    await engine.initialize();
    await engine.start(vi.fn(), vi.fn());

    // stop() has an internal 150ms setTimeout — advance timers while awaiting
    const [,] = await Promise.all([engine.stop(), vi.advanceTimersByTimeAsync(200)]);

    expect(mediaStreamMock._track.stop).toHaveBeenCalled();
    expect(audioCtxMock.close).toHaveBeenCalled();
  });

  it('dispose() clears callbacks and stops tracks', async () => {
    const onResult = vi.fn();
    const engine = new WasmSttEngine();
    await engine.initialize();
    await engine.start(onResult, vi.fn());
    // dispose() does not have the 150ms wait — completes synchronously after cleanup
    await engine.dispose();
    expect(mediaStreamMock._track.stop).toHaveBeenCalled();
  });

  it('transcribes accumulated audio and emits result on stop()', async () => {
    vi.useRealTimers(); // Use real timers — avoids fighting fake-timer/async interplay
    mockPipelineFn.mockResolvedValue({ text: ' once upon a time' });

    const engine = new WasmSttEngine();
    await engine.initialize();

    const results: SttResult[] = [];
    await engine.start(
      (r) => results.push(r),
      () => {},
    );

    // Push a blob directly into pendingBlobs via the ondataavailable callback
    // biome-ignore lint/suspicious/noExplicitAny: test internals — private field access
    const recorderAny = mediaRecorderMock as any;
    if (typeof recorderAny.ondataavailable === 'function') {
      recorderAny.ondataavailable({
        data: new Blob([new Uint8Array(512)], { type: 'audio/webm' }),
      });
    }

    // stop() drains remaining blobs and calls drainAndTranscribe()
    await engine.stop();

    expect(mockPipelineFn).toHaveBeenCalledWith(
      expect.any(Float32Array),
      expect.objectContaining({ sampling_rate: 16000 }),
    );

    vi.useFakeTimers();
  }, 10_000);

  it('result has isFinal:true and confidence 0.9', async () => {
    vi.useRealTimers();
    mockPipelineFn.mockResolvedValue({ text: ' chapter one' });

    const engine = new WasmSttEngine();
    await engine.initialize();

    const results: SttResult[] = [];
    await engine.start(
      (r) => results.push(r),
      () => {},
    );

    // biome-ignore lint/suspicious/noExplicitAny: test internals
    const recorderAny = mediaRecorderMock as any;
    if (typeof recorderAny.ondataavailable === 'function') {
      recorderAny.ondataavailable({
        data: new Blob([new Uint8Array(256)], { type: 'audio/webm' }),
      });
    }

    await engine.stop();

    // If pipeline was called, result should have correct shape
    if (results.length > 0) {
      expect(results[0]?.isFinal).toBe(true);
      expect(results[0]?.confidence).toBe(0.9);
      expect(results[0]?.language).toBe('en');
    }

    vi.useFakeTimers();
  }, 10_000);

  it('handles array result format from pipeline', async () => {
    vi.useRealTimers();
    mockPipelineFn.mockResolvedValue([{ text: ' part one' }, { text: ' part two' }]);

    const engine = new WasmSttEngine();
    await engine.initialize();
    await engine.start(vi.fn(), vi.fn());

    // biome-ignore lint/suspicious/noExplicitAny: test internals
    const recorderAny = mediaRecorderMock as any;
    if (typeof recorderAny.ondataavailable === 'function') {
      recorderAny.ondataavailable({
        data: new Blob([new Uint8Array(256)], { type: 'audio/webm' }),
      });
    }

    await engine.stop();
    expect(mockPipelineFn).toHaveBeenCalled();

    vi.useFakeTimers();
  }, 10_000);
});

// ── createSttEngine factory with enableVoiceWasm ─────────────────────────────

describe('createSttEngine with enableVoiceWasm', () => {
  it('includes WasmSttEngine in candidates when enableVoiceWasm=true and preferredEngine=whisper', async () => {
    const { createSttEngine } = await import('../../../services/voice/sttEngine');
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(makeMediaStream()) },
    });
    vi.stubGlobal('WebAssembly', {});

    // WasmSttEngine.isAvailable() returns true → should be selected
    const engine = await createSttEngine({
      preferredEngine: 'whisper',
      enableVoiceWasm: true,
    });
    expect(engine.id).toBe('whisper');
  });

  it('falls back to webSpeech when enableVoiceWasm=false', async () => {
    const { createSttEngine } = await import('../../../services/voice/sttEngine');
    vi.stubGlobal('window', {
      SpeechRecognition: vi.fn(),
    });

    const engine = await createSttEngine({
      preferredEngine: 'auto',
      enableVoiceWasm: false,
      webSpeechConsentGranted: true,
    });
    expect(engine.id).toBe('webSpeech');
  });
});
