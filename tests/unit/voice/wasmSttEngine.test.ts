// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: { backends: { onnx: { wasm: { proxy: true } } } },
}));

import { pipeline } from '@huggingface/transformers';
import type { SttResult } from '../../../services/voice/voiceTypes';
import { WasmSttEngine } from '../../../services/voice/wasmSttEngine';

const WINDOW_MS = 3_500;
const loadPipeline = vi.mocked(pipeline as unknown as (...args: unknown[]) => Promise<unknown>);
const whisper = vi.fn<(audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>>();

// ── Browser audio fakes ──────────────────────────────────────────────────────

// A real MediaRecorder writes the WebM header into the first chunk of each recording only; a later
// timeslice chunk is a bare cluster that decodeAudioData rejects on its own.
const WEBM_HEADER = [0x1a, 0x45, 0xdf, 0xa3];
const hasHeader = (buffer: ArrayBuffer) =>
  WEBM_HEADER.every((byte, index) => new Uint8Array(buffer)[index] === byte);

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported: (type: string) => boolean = () => true;
  static failNext = false;
  readonly options: MediaRecorderOptions | undefined;
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  private chunks = 0;
  private slicer: ReturnType<typeof setInterval> | null = null;

  constructor(_stream?: unknown, options?: MediaRecorderOptions) {
    if (FakeRecorder.failNext) {
      FakeRecorder.failNext = false;
      throw new DOMException('Unsupported recorder', 'NotSupportedError');
    }
    this.options = options;
    FakeRecorder.instances.push(this);
  }

  start(timeslice?: number) {
    this.state = 'recording';
    if (timeslice) this.slicer = setInterval(() => this.emit(), timeslice);
  }

  stop() {
    if (this.slicer) clearInterval(this.slicer);
    this.state = 'inactive';
    // The browser fires the final dataavailable and then stop, both after stop() returns.
    queueMicrotask(() => {
      this.emit();
      this.onstop?.();
    });
  }

  private emit() {
    const bytes = this.chunks === 0 ? [...WEBM_HEADER, 1, 2, 3] : [5, 6, 7];
    this.chunks += 1;
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }) });
  }
}

// A 440 Hz tone at 0.1 amplitude (RMS 0.07) stands in for speech; zeros are a silent microphone.
const tone = (ms: number) =>
  Float32Array.from(
    { length: (16 * ms) | 0 },
    (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 16000),
  );
const withSilence = (sound: Float32Array, ms: number) => {
  const window = new Float32Array(sound.length + 16 * ms);
  window.set(sound);
  return window;
};
let decodedWindow: Float32Array = tone(1000);

const decodeAudioData = vi.fn(async (buffer: ArrayBuffer) => {
  if (!hasHeader(buffer)) throw new DOMException('Unable to decode audio data', 'EncodingError');
  return { getChannelData: () => decodedWindow };
});

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  decodeAudioData = decodeAudioData;
  close = vi.fn().mockResolvedValue(undefined);
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.instances = [];
  FakeRecorder.isTypeSupported = () => true;
  FakeRecorder.failNext = false;
  FakeAudioContext.instances = [];
  decodeAudioData.mockClear();
  decodedWindow = tone(1000);
  track.stop.mockClear();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] });
  whisper.mockReset().mockResolvedValue({ text: ' hello world' });
  loadPipeline.mockReset().mockResolvedValue(whisper);
  vi.stubGlobal('WebAssembly', {});
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function stopEngine(engine: WasmSttEngine) {
  await Promise.all([engine.stop(), vi.advanceTimersByTimeAsync(200)]);
}

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
    expect(await new WasmSttEngine().isAvailable()).toBe(true);
  });

  it('isAvailable() returns false when WebAssembly is undefined', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    expect(await new WasmSttEngine().isAvailable()).toBe(false);
  });

  it('isAvailable() returns false when getUserMedia is absent', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });
    expect(await new WasmSttEngine().isAvailable()).toBe(false);
  });

  it('loads whisper-tiny.en (q8) once, however often it is initialized', async () => {
    const engine = new WasmSttEngine();
    await Promise.all([engine.initialize(), engine.initialize()]);
    await engine.initialize();
    expect(loadPipeline).toHaveBeenCalledTimes(1);
    expect(loadPipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en',
      {
        dtype: 'q8',
      },
    );
  });

  it('start() requests the microphone', async () => {
    const engine = new WasmSttEngine();
    await engine.start(vi.fn(), vi.fn());
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.anything() }),
    );
    await engine.dispose();
  });

  it('start() throws when getUserMedia is denied', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'));
    await expect(new WasmSttEngine().start(vi.fn(), vi.fn())).rejects.toThrow(
      'Microphone access denied',
    );
  });

  it('stop() releases the microphone and closes the audio context', async () => {
    const engine = new WasmSttEngine();
    await engine.start(vi.fn(), vi.fn());
    await stopEngine(engine);
    expect(track.stop).toHaveBeenCalled();
    expect(FakeAudioContext.instances[0]?.close).toHaveBeenCalled();
  });

  it('dispose() releases the microphone and reports nothing afterwards', async () => {
    const onResult = vi.fn();
    const engine = new WasmSttEngine();
    await engine.start(onResult, vi.fn());
    await engine.dispose();
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2);
    expect(track.stop).toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('reports the first entry of an array result', async () => {
    whisper.mockResolvedValue([{ text: ' part one' }, { text: ' part two' }]);
    const results: SttResult[] = [];
    const engine = new WasmSttEngine();
    await engine.start((result) => results.push(result), vi.fn());
    await stopEngine(engine);
    expect(results.map((result) => result.transcript)).toEqual(['part one']);
  });
});

// The production dictation path (VoiceCommandService.startDictation) calls start() without
// initialize(); before #556 every window was dropped silently and nothing reached the editor.
describe('WasmSttEngine on the dictation path (#556)', () => {
  it('transcribes a window when dictation starts the engine without initialize()', async () => {
    const results: SttResult[] = [];
    const engine = new WasmSttEngine();
    await engine.start((result) => results.push(result), vi.fn());
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(loadPipeline).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual({
      transcript: 'hello world',
      isFinal: true,
      confidence: 0.9,
      language: 'en',
    });
    await engine.dispose();
  });

  it('keeps a final window shorter than one interval', async () => {
    const results: SttResult[] = [];
    const engine = new WasmSttEngine();
    await engine.initialize();
    await engine.start((result) => results.push(result), vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await stopEngine(engine);
    expect(whisper).toHaveBeenCalledWith(expect.any(Float32Array), { sampling_rate: 16000 });
    expect(results).toHaveLength(1);
  });

  it('decodes every window, not only the first', async () => {
    const results: SttResult[] = [];
    const engine = new WasmSttEngine();
    await engine.initialize();
    await engine.start((result) => results.push(result), vi.fn());
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 3 + 300);
    await vi.waitFor(() => expect(results).toHaveLength(3));
    for (const [buffer] of decodeAudioData.mock.calls) expect(hasHeader(buffer)).toBe(true);
    await engine.dispose();
  });

  it('reports windows in recording order when inference is slow', async () => {
    const slow = deferred<unknown>();
    whisper.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ text: ' second' });
    const results: string[] = [];
    const engine = new WasmSttEngine();
    await engine.start((result) => results.push(result.transcript), vi.fn());
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2 + 300);
    expect(results).toEqual([]);
    slow.resolve({ text: ' first' });
    await vi.waitFor(() => expect(results).toEqual(['first', 'second']));
    await engine.dispose();
  });

  it('a failed model load rejects start() before the microphone opens; a retry loads again', async () => {
    loadPipeline.mockRejectedValueOnce(new Error('model fetch failed'));
    const engine = new WasmSttEngine();
    await expect(engine.start(vi.fn(), vi.fn())).rejects.toThrow('model fetch failed');
    expect(getUserMedia).not.toHaveBeenCalled();
    await engine.start(vi.fn(), vi.fn());
    expect(loadPipeline).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await engine.dispose();
  });

  it('a stop while the model loads keeps the microphone closed', async () => {
    const load = deferred<unknown>();
    loadPipeline.mockReturnValueOnce(load.promise);
    const engine = new WasmSttEngine();
    const starting = engine.start(vi.fn(), vi.fn());
    await stopEngine(engine);
    load.resolve(whisper);
    await starting;
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it('a stop while the microphone is granted releases it instead of recording', async () => {
    const grant = deferred<unknown>();
    getUserMedia.mockReturnValueOnce(grant.promise);
    const engine = new WasmSttEngine();
    await engine.initialize();
    const starting = engine.start(vi.fn(), vi.fn());
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await stopEngine(engine);
    grant.resolve({ getTracks: () => [track] });
    await starting;
    expect(track.stop).toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
  });
});

// Review findings on #1260: capture ends at stop, every window stays its own job, and sessions never share resources.
describe('WasmSttEngine capture sessions (#556)', () => {
  it('stop() releases the microphone before a slow inference finishes', async () => {
    const slow = deferred<unknown>();
    whisper.mockReturnValueOnce(slow.promise);
    const engine = new WasmSttEngine();
    await engine.start(vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 100);
    await vi.waitFor(() => expect(whisper).toHaveBeenCalledTimes(1));
    const stopping = engine.stop();
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(FakeRecorder.instances.every((recorder) => recorder.state === 'inactive')).toBe(true);
    slow.resolve({ text: ' first' });
    await stopping;
  });

  it('a window that waited behind a slow inference is transcribed on its own', async () => {
    const slow = deferred<unknown>();
    whisper.mockReturnValueOnce(slow.promise);
    const engine = new WasmSttEngine();
    await engine.start(vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 3 + 300);
    slow.resolve({ text: ' first' });
    await stopEngine(engine);
    // Three full windows and the final partial one, each as its own Whisper input.
    expect(whisper).toHaveBeenCalledTimes(4);
    for (const [audio] of whisper.mock.calls) expect(audio).toHaveLength(decodedWindow.length);
  });

  it('a second start while a session runs opens no second microphone', async () => {
    const engine = new WasmSttEngine();
    await engine.start(vi.fn(), vi.fn());
    await engine.start(vi.fn(), vi.fn());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await engine.dispose();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('a start during a pending stop keeps its own microphone and recorder', async () => {
    const slow = deferred<unknown>();
    whisper.mockReturnValueOnce(slow.promise);
    const engine = new WasmSttEngine();
    await engine.start(vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(WINDOW_MS + 100);
    const stopping = engine.stop();
    const nextTrack = { stop: vi.fn() };
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [nextTrack] });
    await engine.start(vi.fn(), vi.fn());
    slow.resolve({ text: ' first' });
    await stopping;
    expect(nextTrack.stop).not.toHaveBeenCalled();
    expect(FakeRecorder.instances[FakeRecorder.instances.length - 1]?.state).toBe('recording');
    await engine.dispose();
    expect(nextTrack.stop).toHaveBeenCalled();
  });
});

// Review findings on #1260 (second wave): a session that cannot be built must not leak the granted microphone.
describe('WasmSttEngine session construction (#556)', () => {
  it('a recorder that cannot be built releases the microphone and the audio context', async () => {
    FakeRecorder.failNext = true;
    const engine = new WasmSttEngine();
    await expect(engine.start(vi.fn(), vi.fn())).rejects.toThrow('Unsupported recorder');
    expect(track.stop).toHaveBeenCalled();
    expect(FakeAudioContext.instances[0]?.close).toHaveBeenCalled();
    await engine.start(vi.fn(), vi.fn());
    expect(FakeRecorder.instances).toHaveLength(1);
    await engine.dispose();
  });

  it.each([
    [
      'WebM with Opus',
      (type: string) => type === 'audio/webm;codecs=opus',
      { mimeType: 'audio/webm;codecs=opus' },
    ],
    ['only MP4', (type: string) => type === 'audio/mp4', { mimeType: 'audio/mp4' }],
    ['none of the listed types', () => false, undefined],
  ])(
    'records a supported container when the browser supports %s',
    async (_label, supports, expected) => {
      FakeRecorder.isTypeSupported = supports;
      const engine = new WasmSttEngine();
      await engine.start(vi.fn(), vi.fn());
      expect(FakeRecorder.instances[0]?.options).toEqual(expected);
      await engine.dispose();
    },
  );
});

// Whisper writes "you" for a silent window: the real-runtime evidence run filled the editor with it.
describe('WasmSttEngine silence gate (#556)', () => {
  async function transcribeOneWindow(window: Float32Array) {
    decodedWindow = window;
    const onResult = vi.fn();
    const engine = new WasmSttEngine();
    await engine.start(onResult, vi.fn());
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2);
    await stopEngine(engine);
    return onResult;
  }

  it('never runs Whisper on a silent microphone', async () => {
    const onResult = await transcribeOneWindow(new Float32Array(16000));
    expect(whisper).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('skips a window whose only sound is shorter than 200 ms', async () => {
    await transcribeOneWindow(withSilence(tone(100), 900));
    expect(whisper).not.toHaveBeenCalled();
  });

  it('transcribes a window with 200 ms of speech', async () => {
    const onResult = await transcribeOneWindow(withSilence(tone(200), 800));
    expect(whisper).toHaveBeenCalled();
    expect(onResult).toHaveBeenCalled();
  });
});

// ── createSttEngine factory with enableVoiceWasm ─────────────────────────────

describe('createSttEngine with enableVoiceWasm', () => {
  it('selects WasmSttEngine when enableVoiceWasm=true and preferredEngine=whisper', async () => {
    const { createSttEngine } = await import('../../../services/voice/sttEngine');
    const engine = await createSttEngine({ preferredEngine: 'whisper', enableVoiceWasm: true });
    expect(engine.id).toBe('whisper');
  });

  it('falls back to webSpeech when enableVoiceWasm=false', async () => {
    const { createSttEngine } = await import('../../../services/voice/sttEngine');
    vi.stubGlobal('window', { SpeechRecognition: vi.fn() });
    const engine = await createSttEngine({
      preferredEngine: 'auto',
      enableVoiceWasm: false,
      webSpeechConsentGranted: true,
    });
    expect(engine.id).toBe('webSpeech');
  });
});
