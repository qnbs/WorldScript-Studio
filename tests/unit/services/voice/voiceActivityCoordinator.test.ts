/**
 * Tests for VoiceActivityCoordinator — VAD-gated Whisper WASM STT bridge.
 * QNBS-v3: B-2 completion — verifies coordinator start/stop/dispose + error-handling paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), withContext: vi.fn() }),
}));

import { VoiceActivityCoordinator } from '../../../../services/voice/voiceActivityCoordinator';
import type { SttEngine, VadEngine, VadSegment } from '../../../../services/voice/voiceTypes';

// ── Shared mock factories ─────────────────────────────────────────────────────

function makeVad(overrides: Partial<VadEngine> = {}): VadEngine {
  return {
    name: 'test-vad',
    isAvailable: vi.fn().mockResolvedValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    processChunk: vi
      .fn()
      .mockResolvedValue({ startMs: 0, endMs: 20, isSpeech: false } as VadSegment),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeStt(overrides: Partial<SttEngine> = {}): SttEngine {
  return {
    id: 'whisper' as SttEngine['id'],
    name: 'test-stt',
    isLocal: true,
    supportsStreaming: false,
    isAvailable: vi.fn().mockResolvedValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Browser API stubs ─────────────────────────────────────────────────────────

// Mutable state shared across tests — reset in beforeEach
let mockTrack: { stop: ReturnType<typeof vi.fn> };
let mockStream: { getTracks: ReturnType<typeof vi.fn> };
let mockScriptProcessor: {
  onaudioprocess: ((e: unknown) => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
let mockSource: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
let mockAudioCtxInstance: {
  createMediaStreamSource: ReturnType<typeof vi.fn>;
  createScriptProcessor: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  destination: object;
};

function buildMocks() {
  mockTrack = { stop: vi.fn() };
  mockStream = { getTracks: vi.fn().mockReturnValue([mockTrack]) };
  mockScriptProcessor = {
    onaudioprocess: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  mockSource = { connect: vi.fn(), disconnect: vi.fn() };
  mockAudioCtxInstance = {
    createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
    createScriptProcessor: vi.fn().mockReturnValue(mockScriptProcessor),
    close: vi.fn().mockResolvedValue(undefined),
    destination: {},
  };
}

// QNBS-v3: define FakeAudioContext at module level so it closes over the mutable
// mockAudioCtxInstance var (rebuilt each beforeEach), avoiding repeated class definitions.
class FakeAudioContext {
  constructor() {
    // biome-ignore lint/correctness/noConstructorReturn: needed to return mock instance to caller
    // biome-ignore lint/suspicious/noExplicitAny: test constructor shim returns partial mock
    return mockAudioCtxInstance as any;
  }
}

beforeEach(() => {
  buildMocks();

  // vi.stubGlobal registers the stub so vi.unstubAllGlobals() in afterEach can restore jsdom defaults.
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    },
  });
});

afterEach(() => {
  // QNBS-v3: restore AudioContext and navigator to jsdom defaults — prevents global
  // state leaking into subsequent test files and causing order-dependent failures.
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VoiceActivityCoordinator', () => {
  describe('start()', () => {
    it('initializes VAD and STT engines', async () => {
      const vad = makeVad();
      const stt = makeStt();
      const coordinator = new VoiceActivityCoordinator(vad, stt);
      await coordinator.start(vi.fn(), vi.fn());
      expect(vad.initialize).toHaveBeenCalledOnce();
      expect(stt.initialize).toHaveBeenCalledOnce();
      await coordinator.dispose();
    });

    it('requests microphone access with audio constraints', async () => {
      const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());
      await coordinator.start(vi.fn(), vi.fn());
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({ audio: expect.any(Object) }),
      );
      await coordinator.dispose();
    });

    it('wires up script processor for audio capture', async () => {
      const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());
      await coordinator.start(vi.fn(), vi.fn());
      expect(mockAudioCtxInstance.createScriptProcessor).toHaveBeenCalled();
      expect(mockSource.connect).toHaveBeenCalledWith(mockScriptProcessor);
      await coordinator.dispose();
    });

    it('calls onError and rethrows when VAD initialization fails', async () => {
      const initErr = new Error('vad init failed');
      const vad = makeVad({ initialize: vi.fn().mockRejectedValue(initErr) });
      const coordinator = new VoiceActivityCoordinator(vad, makeStt());
      const onError = vi.fn();
      await expect(coordinator.start(vi.fn(), onError)).rejects.toThrow('vad init failed');
      expect(onError).toHaveBeenCalledWith(initErr);
    });

    it('calls onError and rethrows when getUserMedia fails', async () => {
      const gumErr = new Error('permission denied');
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        gumErr,
      );
      const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());
      const onError = vi.fn();
      await expect(coordinator.start(vi.fn(), onError)).rejects.toThrow('permission denied');
      expect(onError).toHaveBeenCalledWith(gumErr);
    });

    it('wraps non-Error rejections in Error for onError callback', async () => {
      // Coordinator rethrows the original value but wraps it for onError
      const vad = makeVad({ initialize: vi.fn().mockRejectedValue('string rejection') });
      const coordinator = new VoiceActivityCoordinator(vad, makeStt());
      const onError = vi.fn();
      await expect(coordinator.start(vi.fn(), onError)).rejects.toBeDefined();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('does not re-initialize engines on subsequent start() calls', async () => {
      // WasmSttEngine keeps a 40 MB pipeline alive — re-initializing would cause memory churn
      const vad = makeVad();
      const stt = makeStt();
      const coordinator = new VoiceActivityCoordinator(vad, stt);
      await coordinator.start(vi.fn(), vi.fn());
      await coordinator.stop();
      await coordinator.start(vi.fn(), vi.fn());
      expect(vad.initialize).toHaveBeenCalledOnce();
      expect(stt.initialize).toHaveBeenCalledOnce();
      await coordinator.dispose();
    });

    it('re-initializes after dispose()', async () => {
      const vad = makeVad();
      const stt = makeStt();
      const coordinator = new VoiceActivityCoordinator(vad, stt);
      await coordinator.start(vi.fn(), vi.fn());
      await coordinator.dispose();
      // dispose() resets isEngineInitialized — second lifecycle calls initialize() again
      await coordinator.start(vi.fn(), vi.fn());
      expect(vad.initialize).toHaveBeenCalledTimes(2);
      expect(stt.initialize).toHaveBeenCalledTimes(2);
      await coordinator.dispose();
    });
  });

  describe('stop()', () => {
    it('disconnects script processor on stop', async () => {
      const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());
      await coordinator.start(vi.fn(), vi.fn());
      await coordinator.stop();
      expect(mockScriptProcessor.disconnect).toHaveBeenCalled();
    });

    it('stops media tracks on stop', async () => {
      const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());
      await coordinator.start(vi.fn(), vi.fn());
      await coordinator.stop();
      expect(mockTrack.stop).toHaveBeenCalled();
    });

    it('is idempotent — safe to call twice without throwing', async () => {
      const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());
      await coordinator.start(vi.fn(), vi.fn());
      await coordinator.stop();
      await expect(coordinator.stop()).resolves.not.toThrow();
    });
  });

  describe('dispose()', () => {
    it('disposes VAD and STT engines', async () => {
      const vad = makeVad();
      const stt = makeStt();
      const coordinator = new VoiceActivityCoordinator(vad, stt);
      await coordinator.start(vi.fn(), vi.fn());
      await coordinator.dispose();
      expect(vad.dispose).toHaveBeenCalledOnce();
      expect(stt.dispose).toHaveBeenCalledOnce();
    });

    it('swallows VAD dispose failure gracefully', async () => {
      const vad = makeVad({ dispose: vi.fn().mockRejectedValue(new Error('vad dispose fail')) });
      const coordinator = new VoiceActivityCoordinator(vad, makeStt());
      await coordinator.start(vi.fn(), vi.fn());
      await expect(coordinator.dispose()).resolves.not.toThrow();
    });

    it('swallows STT dispose failure gracefully', async () => {
      const stt = makeStt({ dispose: vi.fn().mockRejectedValue(new Error('stt dispose fail')) });
      const coordinator = new VoiceActivityCoordinator(makeVad(), stt);
      await coordinator.start(vi.fn(), vi.fn());
      await expect(coordinator.dispose()).resolves.not.toThrow();
    });
  });

  describe('VAD null-segment handling', () => {
    it('treats null segment as "no state change" and does not reset speechChunkCount', async () => {
      // WebRtcVadEngine returns null for most frames (no transition). The coordinator must
      // not interpret null as silence; doing so would reset speechChunkCount and prevent
      // MIN_SPEECH_CHUNKS from ever being reached during continuous speech.
      const vad = makeVad({
        // First call: speech-start edge; subsequent calls: null (ongoing speech)
        processChunk: vi
          .fn()
          .mockResolvedValueOnce({ startMs: 0, endMs: 20, isSpeech: true })
          .mockResolvedValue(null),
      });
      const stt = makeStt();
      const coordinator = new VoiceActivityCoordinator(vad, stt);
      await coordinator.start(vi.fn(), vi.fn());

      // Simulate 3 null frames after the initial speech-start edge via the audio processor
      const processor = mockScriptProcessor;
      const fireFrame = () => {
        if (processor.onaudioprocess) {
          const buf = new Float32Array(4096).fill(0.1);
          (processor.onaudioprocess as (e: unknown) => void)({
            inputBuffer: { getChannelData: () => buf },
          });
        }
      };
      // Fire the speech-start frame
      fireFrame();
      await Promise.resolve();
      // Fire 2 more null frames — should NOT reset speechChunkCount
      fireFrame();
      await Promise.resolve();
      fireFrame();
      await Promise.resolve();

      // STT should NOT have been stopped/restarted (no false-silence flush triggered)
      expect(stt.stop).not.toHaveBeenCalled();
      await coordinator.dispose();
    });
  });
});

// #556 review: a flush still draining must finish before stop() returns, so its command result never lands
// after dictation has taken the STT engine over.
describe('VoiceActivityCoordinator stop during a flush (#556)', () => {
  it('stop() waits for a pending flush and does not restart STT', async () => {
    let drain!: () => void;
    const drained = new Promise<void>((resolve) => {
      drain = resolve;
    });
    const vad = makeVad({
      processChunk: vi
        .fn()
        .mockResolvedValueOnce({ startMs: 0, endMs: 20, isSpeech: true })
        .mockResolvedValueOnce({ startMs: 20, endMs: 40, isSpeech: false })
        .mockResolvedValue(null),
    });
    const stt = makeStt({ stop: vi.fn(() => drained) });
    const coordinator = new VoiceActivityCoordinator(vad, stt);
    await coordinator.start(vi.fn(), vi.fn());
    const frame = new Float32Array(4096).fill(0.1);
    const fire = () =>
      (mockScriptProcessor.onaudioprocess as (e: unknown) => void)({
        inputBuffer: { getChannelData: () => frame },
      });
    fire();
    await vi.waitFor(() => expect(stt.start).toHaveBeenCalledTimes(1));
    fire();
    await vi.waitFor(() => expect(stt.stop).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = coordinator.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopped).toBe(false);
    drain();
    await stopping;
    expect(stt.start).toHaveBeenCalledTimes(1);
  });
});

// #1261: the service forgets a coordinator it stopped, so a start that a stop overtook must not keep the microphone.
describe('VoiceActivityCoordinator stop during start (#1261)', () => {
  it('a stop while the engines load never opens the microphone', async () => {
    let loaded: () => void = () => {};
    const stt = makeStt({
      initialize: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            loaded = resolve;
          }),
      ),
    });
    const coordinator = new VoiceActivityCoordinator(makeVad(), stt);

    const starting = coordinator.start(vi.fn(), vi.fn());
    await vi.waitFor(() => expect(stt.initialize).toHaveBeenCalled());
    await coordinator.stop();
    loaded();
    await starting;

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(mockAudioCtxInstance.createScriptProcessor).not.toHaveBeenCalled();
  });

  it('a stop while the microphone opens releases the stream at once', async () => {
    let opened: (stream: unknown) => void = () => {};
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
      new Promise((resolve) => {
        opened = resolve;
      }) as never,
    );
    const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());

    const starting = coordinator.start(vi.fn(), vi.fn());
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await coordinator.stop();
    opened(mockStream);
    await starting;

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockAudioCtxInstance.createScriptProcessor).not.toHaveBeenCalled();
  });

  it('a stop right after the microphone opened releases the stream the start then receives', async () => {
    const coordinator = new VoiceActivityCoordinator(makeVad(), makeStt());
    const internals = coordinator as unknown as {
      openCapture: (generation: number) => Promise<MediaStream | null>;
    };
    const open = internals.openCapture.bind(coordinator);
    // The stop lands after openCapture() returned and before start() takes the stream over.
    vi.spyOn(internals, 'openCapture').mockImplementationOnce(async (generation) => {
      const stream = await open(generation);
      await coordinator.stop();
      return stream;
    });

    await coordinator.start(vi.fn(), vi.fn());

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockAudioCtxInstance.createScriptProcessor).not.toHaveBeenCalled();
  });
});

// #1265: stop() waited for the whole flush chain, including a restart that can sit on a microphone prompt.
describe('VoiceActivityCoordinator stop during a restart (#1265)', () => {
  it.each([
    ['the late restart finishes after it', false, false],
    ['another session takes the engine over first', false, true],
    // The restart's completion is queued before stop() resumes from its await on the drain.
    ['the restart finishes right as stop() begins', true, false],
  ] as const)(
    'stop() cancels a pending restart and the engine is left alone afterwards: %s',
    async (_case, finishFirst, anotherSession) => {
      let finishRestart!: () => void;
      const vad = makeVad({
        processChunk: vi
          .fn()
          .mockResolvedValueOnce({ startMs: 0, endMs: 20, isSpeech: true })
          .mockResolvedValueOnce({ startMs: 20, endMs: 40, isSpeech: false })
          .mockResolvedValue(null),
      });
      const stt = makeStt({
        start: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockImplementationOnce(() => new Promise<void>((resolve) => (finishRestart = resolve))),
      });
      const coordinator = new VoiceActivityCoordinator(vad, stt);
      await coordinator.start(vi.fn(), vi.fn());
      const frame = new Float32Array(4096).fill(0.1);
      const fire = () =>
        (mockScriptProcessor.onaudioprocess as (e: unknown) => void)({
          inputBuffer: { getChannelData: () => frame },
        });
      fire();
      await vi.waitFor(() => expect(stt.start).toHaveBeenCalledTimes(1));
      fire(); // silence: drain, then a restart that waits
      await vi.waitFor(() => expect(stt.start).toHaveBeenCalledTimes(2));

      if (finishFirst) finishRestart();
      await coordinator.stop(); // must not wait for the pending restart, but stops the engine itself
      expect(stt.stop).toHaveBeenCalledTimes(2); // the drain, then the cancel of the pending restart

      // e.g. dictation takes the engine over right after the stop
      if (anotherSession) await stt.start(vi.fn(), vi.fn());
      finishRestart();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(stt.stop).toHaveBeenCalledTimes(2);
    },
  );
});

// #1265: once stop() cancelled a pending restart, a newer session may own the engine; the old start's failure is not its error.
describe('VoiceActivityCoordinator failed restart (#1265)', () => {
  // CodeAnt on 56c25efb: a synchronous throw was handled with the generation current when the catch ran, after a stop.
  it.each([
    ['after a stop cancelled it', 'reject', true, 0],
    ['while the coordinator still runs', 'reject', false, 1],
    ['with a stop queued before its error is handled', 'throw', true, 0],
    ['while the coordinator still runs', 'throw', false, 1],
  ] as const)(
    'a restart that fails %s (start: %s, stopped first: %s) reports the error %i times',
    async (_when, failure, stopFirst, reported) => {
      let failRestart: (error: Error) => void = () => {};
      let coordinator: VoiceActivityCoordinator | null = null;
      const throwing = () => {
        if (stopFirst) queueMicrotask(() => void coordinator?.stop());
        throw new Error('microphone request failed');
      };
      const rejecting = () => new Promise<void>((_resolve, reject) => (failRestart = reject));
      const vad = makeVad({
        processChunk: vi
          .fn()
          .mockResolvedValueOnce({ startMs: 0, endMs: 20, isSpeech: true })
          .mockResolvedValueOnce({ startMs: 20, endMs: 40, isSpeech: false })
          .mockResolvedValue(null),
      });
      const stt = makeStt({
        start: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockImplementationOnce(failure === 'throw' ? throwing : rejecting),
      });
      const onError = vi.fn();
      coordinator = new VoiceActivityCoordinator(vad, stt);
      await coordinator.start(vi.fn(), onError);
      const frame = new Float32Array(4096).fill(0.1);
      const fire = () =>
        (mockScriptProcessor.onaudioprocess as (e: unknown) => void)({
          inputBuffer: { getChannelData: () => frame },
        });
      fire();
      await vi.waitFor(() => expect(stt.start).toHaveBeenCalledTimes(1));
      fire(); // silence: drain, then a restart that will fail
      await vi.waitFor(() => expect(stt.start).toHaveBeenCalledTimes(2));

      if (failure === 'reject') {
        if (stopFirst) await coordinator.stop();
        failRestart(new Error('microphone request failed'));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onError).toHaveBeenCalledTimes(reported);
    },
  );

  // CodeRabbit on 36522c36: a cancelled restart that settled late cleared the flag of a newer restart, so stop() skipped it.
  it.each(['finishes', 'fails'] as const)(
    'a cancelled restart that %s after a newer restart began leaves that restart to the next stop()',
    async (settling) => {
      let settleOld: () => void = () => {};
      const vad = makeVad({
        processChunk: vi
          .fn()
          .mockResolvedValueOnce({ startMs: 0, endMs: 20, isSpeech: true })
          .mockResolvedValueOnce({ startMs: 20, endMs: 40, isSpeech: false })
          .mockResolvedValueOnce({ startMs: 40, endMs: 60, isSpeech: true })
          .mockResolvedValueOnce({ startMs: 60, endMs: 80, isSpeech: false })
          .mockResolvedValue(null),
      });
      const oldRestart = () =>
        new Promise<void>((resolve, reject) => {
          settleOld = () => (settling === 'finishes' ? resolve() : reject(new Error('late')));
        });
      const stt = makeStt({
        start: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockImplementationOnce(oldRestart) // restart A, e.g. waiting on a microphone prompt
          .mockResolvedValueOnce(undefined)
          .mockImplementationOnce(() => new Promise<void>(() => {})), // restart B, pending at the last stop
      });
      const coordinator = new VoiceActivityCoordinator(vad, stt);
      const frame = new Float32Array(4096).fill(0.1);
      const fire = () =>
        (mockScriptProcessor.onaudioprocess as (e: unknown) => void)({
          inputBuffer: { getChannelData: () => frame },
        });
      const utterance = async (starts: number) => {
        fire();
        await vi.waitFor(() => expect(stt.start).toHaveBeenCalledTimes(starts));
        fire(); // silence: drain, then a restart that waits
        await vi.waitFor(() => expect(stt.start).toHaveBeenCalledTimes(starts + 1));
      };
      await coordinator.start(vi.fn(), vi.fn());
      await utterance(1);
      await coordinator.stop(); // cancels restart A
      await coordinator.start(vi.fn(), vi.fn());
      await utterance(3);
      settleOld();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const stops = vi.mocked(stt.stop).mock.calls.length;

      await coordinator.stop();

      expect(stt.stop).toHaveBeenCalledTimes(stops + 1); // restart B is cancelled as well
    },
  );
});
