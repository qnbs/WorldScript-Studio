import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunLocalTextGeneration = vi.fn();
const mockDetectWebGpuSupport = vi.fn().mockReturnValue(false);
const mockSurrenderLeadership = vi.fn();
const mockAcquireGpu = vi.fn().mockResolvedValue(undefined);
const mockReleaseGpu = vi.fn();
const mockEnsureWebLlmPool = vi.fn();

vi.mock('@domain/ai-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@domain/ai-core')>();
  return {
    ...actual,
    runLocalTextGeneration: mockRunLocalTextGeneration,
    detectWebGpuSupport: mockDetectWebGpuSupport,
    surrenderLeadership: mockSurrenderLeadership,
  };
});

vi.mock('../../services/ai/gpuResourceManager', () => ({
  gpuResourceManager: {
    acquireGpu: mockAcquireGpu,
    releaseGpu: mockReleaseGpu,
    getQueueState: () => ({ current: null, queue: [] }),
  },
}));

// QNBS-v3: P1-1 — the WebLLM worker pool is injected; tests drive its enqueue handle directly.
vi.mock('../../services/workerBusManager', () => ({
  ensureWebLlmPool: mockEnsureWebLlmPool,
}));

// QNBS-v3: A fake WorkerBus handle. `progress` lets a test push worker progress events; `result`
//          resolves/rejects to simulate worker success/failure.
function makeFakeBus(opts: {
  result: Promise<unknown>;
  progressEvents?: Array<{ stage: string; progress: number; message?: string }>;
}) {
  const enqueue = vi.fn(
    (_taskType: string, _payload: unknown, enqueueOpts: { onProgress?: (p: unknown) => void }) => {
      for (const ev of opts.progressEvents ?? []) {
        enqueueOpts.onProgress?.({
          taskId: 't',
          taskType: 'inference.webllm',
          timestamp: 0,
          ...ev,
        });
      }
      return {
        taskId: 't',
        result: opts.result,
        progress: (async function* () {})(),
        cancel: vi.fn(),
      };
    },
  );
  return { enqueue };
}

// QNBS-v3: jsdom has no Worker global; define a stub so the worker-first branch is reachable.
function withWorkerGlobal(fn: () => Promise<void>): () => Promise<void> {
  const g = globalThis as { Worker?: unknown };
  return async () => {
    const had = 'Worker' in globalThis;
    g.Worker = class {};
    try {
      await fn();
    } finally {
      if (!had) delete g.Worker;
    }
  };
}

describe('localAiFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // QNBS-v3: Re-assert defaults after clearAllMocks (which wipes call history but not impls).
    mockDetectWebGpuSupport.mockReturnValue(false);
    mockAcquireGpu.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  it('returns local layer result when runLocalTextGeneration succeeds', async () => {
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'AI output' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    const result = await generateLocalText('prompt');
    expect(result.text).toBeTruthy();
    expect(typeof result.layer).toBe('string');
  });

  it('passes AbortSignal to runLocalTextGeneration (no-GPU path)', async () => {
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'ok' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    const controller = new AbortController();
    await generateLocalText('prompt', 'model', undefined, undefined, controller.signal);
    // QNBS-v3: generateLocalText always wraps onProgress in its own reportProgress closure, so the 3rd arg is never the caller's raw undefined even when no onProgress was passed.
    expect(mockRunLocalTextGeneration).toHaveBeenCalledWith(
      'prompt',
      'model',
      expect.any(Function),
      controller.signal,
    );
  });

  it('returns heuristic fallback when runLocalTextGeneration throws', async () => {
    mockRunLocalTextGeneration.mockRejectedValue(new Error('WebLLM failed'));
    const { generateLocalText } = await import('../../services/localAiFacade');
    const result = await generateLocalText('prompt');
    expect(result.layer).toBe('heuristic');
    expect(result.text).toBeTruthy();
  });

  it('returns telemetry object from getLocalWorkerBusTelemetry', async () => {
    const { getLocalWorkerBusTelemetry } = await import('../../services/localAiFacade');
    const tele = getLocalWorkerBusTelemetry();
    expect(tele).toBeTruthy();
    expect(typeof tele).toBe('object');
  });

  it('acquires and releases GPU mutex when WebGPU is available', async () => {
    mockDetectWebGpuSupport.mockReturnValue(true);
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'ok' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    await generateLocalText('prompt');
    expect(mockAcquireGpu).toHaveBeenCalledWith('webllm', 'high');
    expect(mockReleaseGpu).toHaveBeenCalledWith('webllm');
    expect(mockSurrenderLeadership).toHaveBeenCalled();
  });

  it('skips GPU mutex when WebGPU is not available', async () => {
    mockDetectWebGpuSupport.mockReturnValue(false);
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'ok' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    await generateLocalText('prompt');
    expect(mockAcquireGpu).not.toHaveBeenCalled();
    expect(mockSurrenderLeadership).toHaveBeenCalled();
  });

  it('releases GPU and surrenders leadership even when generation throws', async () => {
    mockDetectWebGpuSupport.mockReturnValue(true);
    mockRunLocalTextGeneration.mockRejectedValue(new Error('GPU OOM'));
    const { generateLocalText } = await import('../../services/localAiFacade');
    const result = await generateLocalText('prompt');
    expect(result.layer).toBe('heuristic');
    expect(mockReleaseGpu).toHaveBeenCalledWith('webllm');
    expect(mockSurrenderLeadership).toHaveBeenCalled();
  });

  // --- P1-1: WebLLM worker offload ------------------------------------------

  it(
    'routes to the WebLLM worker and returns its result when WebGPU + Worker are available',
    withWorkerGlobal(async () => {
      mockDetectWebGpuSupport.mockReturnValue(true);
      mockEnsureWebLlmPool.mockResolvedValue(
        makeFakeBus({
          result: Promise.resolve({ text: 'worker says hi', layer: 'webllm', modelId: 'm' }),
        }),
      );
      const { generateLocalText } = await import('../../services/localAiFacade');
      const result = await generateLocalText('prompt', 'm');
      expect(result.layer).toBe('webllm');
      expect(result.text).toBe('worker says hi');
      // The main-thread orchestrator must NOT run when the worker succeeds.
      expect(mockRunLocalTextGeneration).not.toHaveBeenCalled();
    }),
  );

  it(
    'forwards loraAdapterId in the worker task payload',
    withWorkerGlobal(async () => {
      mockDetectWebGpuSupport.mockReturnValue(true);
      const bus = makeFakeBus({
        result: Promise.resolve({ text: 'ok', layer: 'webllm', modelId: 'm' }),
      });
      mockEnsureWebLlmPool.mockResolvedValue(bus);
      const { generateLocalText } = await import('../../services/localAiFacade');
      await generateLocalText('prompt', 'm', undefined, 'my-lora');
      expect(bus.enqueue).toHaveBeenCalledWith(
        'inference.webllm',
        expect.objectContaining({ modelId: 'm', loraAdapterId: 'my-lora' }),
        expect.objectContaining({ capabilities: ['inference.webllm'] }),
      );
    }),
  );

  it(
    'falls back to the main thread when the worker returns an empty result',
    withWorkerGlobal(async () => {
      mockDetectWebGpuSupport.mockReturnValue(true);
      mockEnsureWebLlmPool.mockResolvedValue(
        makeFakeBus({ result: Promise.resolve({ text: '', layer: 'webllm', modelId: 'm' }) }),
      );
      mockRunLocalTextGeneration.mockResolvedValue({ layer: 'onnx', text: 'fallback text' });
      const { generateLocalText } = await import('../../services/localAiFacade');
      const result = await generateLocalText('prompt', 'm');
      expect(mockRunLocalTextGeneration).toHaveBeenCalled();
      expect(result.text).toBe('fallback text');
    }),
  );

  it(
    'falls back to the main thread when the worker task rejects (NO_WEBGPU)',
    withWorkerGlobal(async () => {
      mockDetectWebGpuSupport.mockReturnValue(true);
      mockEnsureWebLlmPool.mockResolvedValue(
        makeFakeBus({ result: Promise.reject(new Error('NO_WEBGPU')) }),
      );
      mockRunLocalTextGeneration.mockResolvedValue({ layer: 'transformers', text: 'cpu fallback' });
      const { generateLocalText } = await import('../../services/localAiFacade');
      const result = await generateLocalText('prompt', 'm');
      expect(mockRunLocalTextGeneration).toHaveBeenCalled();
      expect(result.text).toBe('cpu fallback');
    }),
  );

  it(
    'maps worker progress events onto inferenceProgressEmitter',
    withWorkerGlobal(async () => {
      mockDetectWebGpuSupport.mockReturnValue(true);
      mockEnsureWebLlmPool.mockResolvedValue(
        makeFakeBus({
          result: Promise.resolve({ text: 'done', layer: 'webllm', modelId: 'm' }),
          progressEvents: [
            { stage: 'loading', progress: 0.5, message: 'half' },
            { stage: 'done', progress: 1, message: 'Complete' },
          ],
        }),
      );
      const { inferenceProgressEmitter } = await import(
        '../../services/ai/inferenceProgressEmitter'
      );
      const progSpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmProgress');
      const readySpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmReady');
      const { generateLocalText } = await import('../../services/localAiFacade');
      // QNBS-v3: reportToGlobalProgress:true simulates preloadLocalModel's call — the only caller that should drive the singleton emitter (see the ordinary-call test right below).
      await generateLocalText('prompt', 'm', undefined, undefined, undefined, {
        reportToGlobalProgress: true,
      });
      expect(progSpy).toHaveBeenCalledWith(0.5, 'half');
      expect(readySpy).toHaveBeenCalled();
      progSpy.mockRestore();
      readySpy.mockRestore();
    }),
  );

  it(
    'does not touch the global download emitter for an ordinary generation call',
    withWorkerGlobal(async () => {
      // QNBS-v3: regression test — an ordinary Writer/Copilot/ProForge call (no reportToGlobalProgress) must never make the global "downloading a model" modal appear.
      mockDetectWebGpuSupport.mockReturnValue(true);
      mockEnsureWebLlmPool.mockResolvedValue(
        makeFakeBus({
          result: Promise.resolve({ text: 'done', layer: 'webllm', modelId: 'm' }),
          progressEvents: [{ stage: 'loading', progress: 0.5, message: 'half' }],
        }),
      );
      const { inferenceProgressEmitter } = await import(
        '../../services/ai/inferenceProgressEmitter'
      );
      const progSpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmProgress');
      const readySpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmReady');
      const { generateLocalText } = await import('../../services/localAiFacade');
      await generateLocalText('prompt', 'm');
      expect(progSpy).not.toHaveBeenCalled();
      expect(readySpy).not.toHaveBeenCalled();
      progSpy.mockRestore();
      readySpy.mockRestore();
    }),
  );

  it('isLocalAiBusy() is true while a generateLocalText call is in flight, false after', async () => {
    const { generateLocalText, isLocalAiBusy } = await import('../../services/localAiFacade');
    let resolveGen: (v: { layer: string; text: string }) => void = () => {};
    // No WebGPU (default) → straight to the main-thread orchestrator, which we hold pending.
    mockRunLocalTextGeneration.mockReturnValue(
      new Promise((res) => {
        resolveGen = res;
      }),
    );

    expect(isLocalAiBusy()).toBe(false);
    const p = generateLocalText('prompt'); // ONNX/Transformers-style run (no GPU mutex, no loading)
    await Promise.resolve();
    expect(isLocalAiBusy()).toBe(true);

    resolveGen({ layer: 'onnx', text: 'done' });
    await p;
    expect(isLocalAiBusy()).toBe(false);
  });

  it('an older preload finishing does not clobber a newer preload cancel hook', async () => {
    const { preloadLocalModel, abortActivePreload } = await import('../../services/localAiFacade');
    const signals: AbortSignal[] = [];
    const resolvers: Array<(v: { layer: string; text: string }) => void> = [];
    // Capture each call's signal; keep both generations pending.
    mockRunLocalTextGeneration.mockImplementation(
      (_p: string, _m: string | undefined, _op: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise((res) => resolvers.push(res));
      },
    );

    const pA = preloadLocalModel('A');
    await Promise.resolve();
    const pB = preloadLocalModel('B'); // newer → owns the active cancel hook
    await Promise.resolve();

    // Older A resolves first; its finally must NOT clear B's still-active hook.
    resolvers[0]?.({ layer: 'onnx', text: 'a' });
    await pA;

    expect(signals[1]?.aborted).toBe(false);
    abortActivePreload(); // must still abort B
    expect(signals[1]?.aborted).toBe(true);

    resolvers[1]?.({ layer: 'onnx', text: 'b' });
    await pB;
  });

  it('a superseded preload settling late does not overwrite a newer preload modal state', async () => {
    // QNBS-v3: regression test — retryLastPreload() starting attempt B while superseded attempt A's generateLocalText call is still settling must not let A's late error/reset/ready overwrite B's own progress.
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    const errorSpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmError');
    const readySpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmReady');
    const { preloadLocalModel } = await import('../../services/localAiFacade');

    const resolvers: Array<(v: { layer: string; text: string }) => void> = [];
    mockRunLocalTextGeneration.mockImplementation(() => new Promise((res) => resolvers.push(res)));

    const pA = preloadLocalModel('A');
    await Promise.resolve();
    const pB = preloadLocalModel('B'); // newer → owns the active progress-report identity
    await Promise.resolve();

    // A's stale fallback settles AFTER B has become current — must not touch the emitter.
    resolvers[0]?.({ layer: 'onnx', text: 'a' });
    await pA;
    expect(errorSpy).not.toHaveBeenCalled();
    expect(readySpy).not.toHaveBeenCalled();

    // B, still current, resolves with a real WebLLM warm-up — this IS allowed to report ready.
    resolvers[1]?.({ layer: 'webllm', text: 'b' });
    await pB;
    expect(readySpy).toHaveBeenCalled();
  });

  it('publishes a terminal error when a main-thread fallback cannot warm the requested WebLLM model', async () => {
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'onnx', text: 'fallback' });
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    const progressSpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmProgress');
    const errorSpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmError');
    const { preloadLocalModel } = await import('../../services/localAiFacade');

    await expect(preloadLocalModel('Qwen2.5-0.5B')).resolves.toMatchObject({ downloaded: false });

    expect(progressSpy).toHaveBeenCalledWith(0, 'Preparing local model');
    expect(errorSpy).toHaveBeenCalledWith('Local model preload did not complete');
  });

  it('retryLastPreload throws when no preload has been requested yet', async () => {
    // QNBS-v3: lastPreloadModelId is module-level state — reset the module so this observes the true initial value, not whatever a prior test in this file already set it to.
    vi.resetModules();
    const { retryLastPreload } = await import('../../services/localAiFacade');
    await expect(retryLastPreload()).rejects.toThrow(/no local model download/i);
  });

  it('does not publish a WebLLM error when preload fails because the user cancelled it', async () => {
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    const errorSpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmError');
    const { preloadLocalModel, abortActivePreload } = await import('../../services/localAiFacade');

    mockRunLocalTextGeneration.mockImplementation(async () => {
      // Simulates the Cancel button firing while generation is in flight.
      abortActivePreload();
      throw new Error('aborted mid-flight');
    });

    await expect(preloadLocalModel('Qwen2.5-0.5B')).rejects.toThrow('aborted mid-flight');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('resets the emitter (not error) when a caller-provided signal aborts the preload', async () => {
    // QNBS-v3: regression test — a caller-provided AbortSignal (distinct from the modal's own Cancel button) previously left the emitter stuck in 'loading' since the catch only suppressed the error report without resetting it.
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    const errorSpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmError');
    const resetSpy = vi.spyOn(inferenceProgressEmitter, 'reset');
    const { preloadLocalModel } = await import('../../services/localAiFacade');

    const controller = new AbortController();
    mockRunLocalTextGeneration.mockImplementation(async () => {
      controller.abort();
      const err = new DOMException('aborted', 'AbortError');
      throw err;
    });

    await expect(preloadLocalModel('Qwen2.5-0.5B', undefined, controller.signal)).rejects.toThrow();
    expect(resetSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('resets the emitter when a preload falls back off WebLLM (generateLocalText level)', async () => {
    // QNBS-v3: regression test — generateLocalText itself must terminate 'loading' for any reportToGlobalProgress caller whose result isn't webllm, not only for preloadLocalModel's own outer handling.
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'onnx', text: 'fallback' });
    const { inferenceProgressEmitter } = await import('../../services/ai/inferenceProgressEmitter');
    const resetSpy = vi.spyOn(inferenceProgressEmitter, 'reset');
    const readySpy = vi.spyOn(inferenceProgressEmitter, 'reportWebLlmReady');
    const { generateLocalText } = await import('../../services/localAiFacade');

    await generateLocalText('prompt', 'm', undefined, undefined, undefined, {
      reportToGlobalProgress: true,
    });

    expect(resetSpy).toHaveBeenCalled();
    expect(readySpy).not.toHaveBeenCalled();
  });
});
