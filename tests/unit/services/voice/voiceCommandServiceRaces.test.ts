/**
 * Tests for voiceCommandService.ts — engine setup and session ownership races (#1265): a dispose voids a running
 * setup, and stops or newer starts win over older ones. The mocks match voiceCommandService.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../../../services/ai/ecoModeService', () => ({
  ecoModeService: {
    isEcoMode: vi.fn(() => false),
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

vi.mock('../../../../services/voice/sttEngine', async (importOriginal) => ({
  // The gate throws the real refusal, so its message is the one users see.
  ConsentRequiredError: (
    await importOriginal<typeof import('../../../../services/voice/sttEngine')>()
  ).ConsentRequiredError,
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
  reportVoiceIssue: vi.fn(),
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

// The pipeline factory is mocked, so no case loads the real transformers runtime.
const { mockPipeline } = vi.hoisted(() => ({ mockPipeline: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipeline,
  env: { backends: { onnx: { wasm: {} } } },
}));

import { appStoreRef } from '../../../../app/storeRef';
import {
  setActiveSttEngine,
  setActiveTtsEngine,
  setMicrophonePermission,
  setSttStatus,
  setTtsStatus,
  setVadStatus,
  setVoiceError,
  setWakeWordStatus,
} from '../../../../features/voice/voiceSlice';
import { setActiveAiMode } from '../../../../services/ai/aiModeService';
import { ConsentRequiredError, createSttEngine } from '../../../../services/voice/sttEngine';
import { createTtsEngine } from '../../../../services/voice/ttsEngine';
import { createVadEngine } from '../../../../services/voice/vadEngine';
import { VoiceCommandService } from '../../../../services/voice/voiceCommandService';
import { RecoverableSttError } from '../../../../services/voice/voiceTypes';
import { createWakeWordEngine } from '../../../../services/voice/wakeWordEngine';
import { registerWebSpeechConsentPrompt } from '../../../../services/voice/webSpeechConsent';

/** initialize() asks for the microphone; each case gets its own stub instead of relying on one an earlier case left. */
function stubMicrophone() {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    writable: true,
    configurable: true,
  });
}

/** Keeps the next call of `fn` pending until the returned release runs. */
function holdNext(fn: ReturnType<typeof vi.fn>): () => void {
  let release: () => void = () => {};
  fn.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return () => release();
}

/** Lets pending promise callbacks run. */
const settledTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A store reference that holds only the Web Speech consent; returns the voice settings so a test can change it. */
function storeConsent(granted: boolean) {
  const voice = { webSpeechConsentGranted: granted };
  appStoreRef.current = {
    getState: () => ({ settings: { voice } }),
    dispatch: vi.fn(),
  } as unknown as typeof appStoreRef.current;
  return voice;
}

// #1265: engine setup and session ownership; a dispose voids a setup, and stops or newer starts win over older ones.
describe('VoiceCommandService engine setup races (#1265)', () => {
  type Kind = 'listening' | 'dictation';
  const start = (service: VoiceCommandService, kind: Kind) =>
    kind === 'listening' ? service.startListening() : service.startDictation();
  let service: VoiceCommandService;
  let unregister = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    stubMicrophone();
    service = new VoiceCommandService({ enableVoiceWasm: false });
    service.setDispatch(vi.fn() as never, vi.fn() as never);
  });

  afterEach(async () => {
    // A successful listening start arms the 8-second auto-stop timer; dispose clears it so no case outlives itself.
    await service.dispose();
    unregister();
    unregister = () => {};
    setActiveAiMode('hybrid');
    appStoreRef.current = null;
  });

  /** An STT engine stand-in; Web Speech declares itself not local. */
  function sttEngine(isLocal = false) {
    return {
      id: isLocal ? 'whisper' : 'webSpeech',
      name: isLocal ? 'Whisper' : 'Web Speech API',
      isLocal,
      isAvailable: vi.fn().mockResolvedValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
  }

  /** Makes `engine` the next one the service builds. */
  function buildsNext(engine: ReturnType<typeof sttEngine>) {
    vi.mocked(createSttEngine).mockResolvedValueOnce(engine as never);
    return engine;
  }

  /** A consent dialog that answers `answer`; a grant stores the consent, as VoicePrivacyConsentModal does. Null mounts none. */
  function dialog(
    voice: { webSpeechConsentGranted: boolean },
    answer: boolean | Promise<boolean> | null,
  ) {
    const ask = vi.fn(async () => {
      const granted = await answer;
      if (granted) voice.webSpeechConsentGranted = true;
      return granted === true;
    });
    if (answer !== null) unregister = registerWebSpeechConsentPrompt(ask);
    return ask;
  }

  it('a dispose while the engines are built releases them instead of publishing them', async () => {
    storeConsent(true);
    const stale = sttEngine();
    let build: () => void = () => {};
    vi.mocked(createSttEngine).mockReturnValueOnce(
      new Promise((resolve) => {
        build = () => resolve(stale);
      }) as never,
    );

    const run = service.startListening();
    await vi.waitFor(() => expect(createSttEngine).toHaveBeenCalled());
    await service.dispose();
    build();
    await run;
    expect(stale.dispose).toHaveBeenCalled();
    expect(stale.start).not.toHaveBeenCalled();

    // The disposed service builds fresh engines at its next start instead of reusing the released ones.
    const fresh = buildsNext(sttEngine());
    await service.startListening();
    expect(fresh.start).toHaveBeenCalledTimes(1);
    expect(stale.start).not.toHaveBeenCalled();
  });

  it('a dispose while a changed engine choice is applied builds no engines for the voided setup', async () => {
    storeConsent(true);
    const old = buildsNext(sttEngine());
    await service.initialize();
    const released = holdNext(old.dispose);
    service.updateConfig({ preferredSttEngine: 'whisper' });

    const run = service.startListening();
    await vi.waitFor(() => expect(old.dispose).toHaveBeenCalled());
    await service.dispose();
    released();
    await run;

    expect(createSttEngine).toHaveBeenCalledTimes(1); // the first setup's engine only
  });

  // CodeAnt on cf80f07f: a voided setup reached initialize() later and cleared the flag of a change made meanwhile.
  it('an engine change made while a fresh setup builds survives a voided setup that finishes after it', async () => {
    storeConsent(true);
    const old = buildsNext(sttEngine());
    await service.initialize();
    const released = holdNext(old.dispose);
    service.updateConfig({ preferredSttEngine: 'whisper' });
    const voided = service.startDictation();
    await vi.waitFor(() => expect(old.dispose).toHaveBeenCalled());
    await service.dispose();
    const building = sttEngine();
    let built: () => void = () => {};
    vi.mocked(createSttEngine).mockReturnValueOnce(
      new Promise((resolve) => {
        built = () => resolve(building);
      }) as never,
    );
    const fresh = service.startDictation();
    await vi.waitFor(() => expect(createSttEngine).toHaveBeenCalledTimes(2));
    service.updateConfig({ preferredSttEngine: 'webSpeech' }); // changed while the fresh setup builds
    released();
    await voided;
    built();
    await fresh;
    await service.stopDictation();

    const next = buildsNext(sttEngine());
    await service.startDictation();

    expect(building.dispose).toHaveBeenCalled(); // the change replaced the engines built before it
    expect(next.start).toHaveBeenCalledTimes(1);
  });

  // CodeRabbit on ae7c4269: a direct-STT teardown clears the timer before its engine stop drains.
  it('a listening start waits for a draining command teardown; a stop meanwhile cancels it', async () => {
    storeConsent(true);
    const engine = buildsNext(sttEngine());
    await service.startListening();
    const drained = holdNext(engine.stop);

    const stopping = service.stopListening();
    const second = service.startListening();
    await settledTick();
    expect(engine.start).toHaveBeenCalledTimes(1);
    const stoppingAgain = service.stopListening();
    drained();
    await Promise.all([stopping, second, stoppingAgain]);

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  // CodeRabbit on ae7c4269: dispose() lets a fresh setup finish before a voided one settles.
  it('a failing release of a voided setup is not reported against the fresh session', async () => {
    storeConsent(true);
    const stale = sttEngine();
    stale.dispose.mockRejectedValue(new Error('dispose failed'));
    let build: () => void = () => {};
    vi.mocked(createSttEngine).mockReturnValueOnce(
      new Promise((resolve) => {
        build = () => resolve(stale);
      }) as never,
    );
    const first = service.startDictation();
    await vi.waitFor(() => expect(createSttEngine).toHaveBeenCalled());
    await service.dispose();
    const fresh = buildsNext(sttEngine());
    const second = service.startDictation();
    await vi.waitFor(() => expect(fresh.start).toHaveBeenCalled());
    vi.mocked(setVoiceError).mockClear();

    build();
    await Promise.all([first, second]);

    expect(stale.dispose).toHaveBeenCalled();
    expect(setVoiceError).not.toHaveBeenCalledWith('dispose failed');
  });

  // CodeRabbit on 4723a2d9 and 36522c36: the late steps of a voided setup still wrote their state over the fresh session's.
  it.each([
    ['microphone answer', 'succeed'],
    ['microphone answer', 'fail'],
    ['engine builds', 'succeed'],
    ['engine builds', 'fail'],
  ] as const)(
    'late %s of a voided setup (%s) leave the state of the fresh session alone',
    async (step, outcome) => {
      storeConsent(true);
      const microphone = step === 'microphone answer';
      const held = microphone
        ? [navigator.mediaDevices.getUserMedia]
        : [createSttEngine, createTtsEngine, createVadEngine, createWakeWordEngine];
      const late = microphone ? { getTracks: () => [] } : sttEngine();
      const settles = held.map((create) => {
        let settle: () => void = () => {};
        vi.mocked(create).mockReturnValueOnce(
          new Promise((resolve, reject) => {
            settle = () => (outcome === 'succeed' ? resolve(late) : reject(new Error('late')));
          }) as never,
        );
        return () => settle();
      });
      const first = service.startDictation();
      // The first setup's own request is the held one: each case starts from a fresh microphone stub.
      await vi.waitFor(() => expect(held.at(-1)).toHaveBeenCalledTimes(1));
      await service.dispose();
      const fresh = buildsNext(sttEngine());
      const second = service.startDictation();
      await vi.waitFor(() => expect(fresh.start).toHaveBeenCalled());
      const writes = [
        setMicrophonePermission,
        setSttStatus,
        setActiveSttEngine,
        setTtsStatus,
        setActiveTtsEngine,
        setVadStatus,
        setWakeWordStatus,
      ];
      for (const write of writes) vi.mocked(write).mockClear();

      for (const settle of settles) settle();
      await Promise.all([first, second]);

      for (const write of writes) expect(write).not.toHaveBeenCalled();
    },
  );

  it('a stop while a listening start waits for dictation to end cancels that listening start', async () => {
    storeConsent(true);
    const engine = buildsNext(sttEngine());
    await service.startDictation();
    let drained: () => void = () => {};
    engine.stop.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        drained = resolve;
      }),
    );

    const listening = service.startListening(); // takes the engine over: ends the dictation first
    await vi.waitFor(() => expect(engine.stop).toHaveBeenCalled());
    const stopping = service.stopListening();
    drained();
    await Promise.all([listening, stopping]);

    expect(engine.start).toHaveBeenCalledTimes(1); // the dictation only
  });

  it('a stop while the engine starts leaves nothing behind that blocks the next listening start', async () => {
    storeConsent(true);
    const engine = buildsNext(sttEngine());
    const started = holdNext(engine.start);

    const first = service.startListening();
    await vi.waitFor(() => expect(engine.start).toHaveBeenCalled());
    await service.stopListening();
    started();
    await first;
    // The stop ran before the engine was running, so the start ends what it began.
    expect(engine.stop).toHaveBeenCalledTimes(2);
    await service.startListening();

    expect(engine.start).toHaveBeenCalledTimes(2);
    await service.stopListening();
  });

  // #1265, deferred from #1279: an engine change released the old engines only when ending the session succeeded.
  it('a failing session end during an engine change still releases the old engines', async () => {
    storeConsent(true);
    const old = buildsNext(sttEngine());
    await service.initialize();
    old.stop.mockRejectedValueOnce(new Error('stop failed'));
    service.updateConfig({ preferredSttEngine: 'whisper' });
    const fresh = buildsNext(sttEngine());

    await service.startDictation();

    expect(old.dispose).toHaveBeenCalled();
    expect(fresh.start).toHaveBeenCalledTimes(1);
  });

  // #1265, deferred from #1279: a start after a dispose joined the setup the dispose had voided, and failed.
  it('a dictation started right after a dispose builds fresh engines instead of joining the voided setup', async () => {
    storeConsent(true);
    const stale = sttEngine();
    let build: () => void = () => {};
    vi.mocked(createSttEngine).mockReturnValueOnce(
      new Promise((resolve) => {
        build = () => resolve(stale);
      }) as never,
    );
    const first = service.startDictation();
    await vi.waitFor(() => expect(createSttEngine).toHaveBeenCalled());
    await service.dispose();
    const fresh = buildsNext(sttEngine());

    const second = service.startDictation();
    build();
    await first;
    await second;

    expect(fresh.start).toHaveBeenCalledTimes(1);
    expect(stale.start).not.toHaveBeenCalled();
    expect(stale.dispose).toHaveBeenCalled();
  });

  // #1265, deferred from #1279: a start the user had stopped reported ConsentRequiredError once they declined.
  it.each(['listening', 'dictation'] as const)(
    '%s: a start stopped while the consent dialog is open ends quietly when the user then declines',
    async (kind) => {
      const voice = storeConsent(false);
      const engine = buildsNext(sttEngine());
      let answer: (granted: boolean) => void = () => {};
      const ask = dialog(
        voice,
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
      );

      const run = start(service, kind);
      await vi.waitFor(() => expect(ask).toHaveBeenCalled());
      await (kind === 'listening' ? service.stopListening() : service.stopDictation());
      answer(false);

      await expect(run).resolves.toBeUndefined();
      expect(engine.start).not.toHaveBeenCalled();
      expect(setVoiceError).not.toHaveBeenCalledWith(new ConsentRequiredError().message);
    },
  );
});

// #1265: review wave 4 on #1260 — dictation state must follow the session that really owns the engine.
describe('VoiceCommandService dictation races (#1265)', () => {
  let service: VoiceCommandService;

  beforeEach(async () => {
    vi.clearAllMocks();
    stubMicrophone();
    // The default engine mock declares no isLocal, so it counts as a cloud engine and needs the stored consent.
    storeConsent(true);
    service = new VoiceCommandService({ enableVoiceWasm: false });
    service.setDispatch(vi.fn() as never, vi.fn() as never);
    await service.initialize();
  });

  afterEach(async () => {
    await service.dispose();
    appStoreRef.current = null;
  });

  async function sttEngine() {
    const { createSttEngine } = await import('../../../../services/voice/sttEngine');
    return vi.mocked(createSttEngine).mock.results.at(-1)?.value;
  }

  it('a recoverable window error is reported without ending dictation', async () => {
    const { reportVoiceIssue, setVoiceError, setDictationActive } = await import(
      '../../../../features/voice/voiceSlice'
    );
    await service.startDictation();
    const engine = await sttEngine();
    const onError = vi.mocked(engine.start).mock.calls.at(-1)?.[1] as (error: Error) => void;
    vi.mocked(setDictationActive).mockClear();

    onError(new RecoverableSttError('A recording window was skipped'));

    expect(reportVoiceIssue).toHaveBeenCalledWith('A recording window was skipped');
    expect(setVoiceError).not.toHaveBeenCalledWith('A recording window was skipped');
    expect(setDictationActive).not.toHaveBeenCalled();
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('a stop issued while a start waits for the previous drain wins', async () => {
    await service.startDictation();
    const engine = await sttEngine();
    let finishDrain!: () => void;
    vi.mocked(engine.stop).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishDrain = resolve)),
    );
    const firstStop = service.stopDictation();
    const restart = service.startDictation(); // waits for the drain
    const newerStop = service.stopDictation(); // pressed after the restart
    finishDrain();
    await Promise.all([firstStop, restart, newerStop]);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('a stale failed start does not roll back a newer session', async () => {
    const { setDictationActive, setVoiceError } = await import(
      '../../../../features/voice/voiceSlice'
    );
    const engine = await sttEngine();
    let failFirst!: (error: Error) => void;
    vi.mocked(engine.start).mockImplementationOnce(
      () => new Promise<void>((_, reject) => (failFirst = reject)),
    );
    const first = service.startDictation().catch(() => undefined);
    await vi.waitFor(() => expect(engine.start).toHaveBeenCalledTimes(1));
    await service.stopDictation();
    await service.startDictation(); // the newer session starts normally
    vi.mocked(setDictationActive).mockClear();

    failFirst(new Error('model failed to load'));
    await first;

    expect(setDictationActive).not.toHaveBeenCalledWith(false);
    expect(setVoiceError).not.toHaveBeenCalledWith('model failed to load');
  });

  it('concurrent command stops share one teardown', async () => {
    await service.startListening();
    const engine = await sttEngine();
    let release!: () => void;
    vi.mocked(engine.stop).mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const first = service.stopListening();
    const second = service.stopListening();
    release();
    await Promise.all([first, second]);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });
});
