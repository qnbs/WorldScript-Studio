import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Mutable state shared with relative-path mock factories via vi.hoisted. The source does
//          dynamic import('@mlc-ai/web-llm') / import('@huggingface/transformers'); those resolve via
//          alias/pnpm-symlink to the realpaths below, so package-name mocks do NOT intercept them —
//          only resolved-path mocks do (mirrors tests/unit/aiCoreFallbackPaths.test.ts).
const mlcState = vi.hoisted(() => ({
  engineFn: undefined as ((...args: unknown[]) => Promise<unknown>) | undefined,
}));

const xenovaState = vi.hoisted(() => ({
  pipelineImpl: undefined as
    | ((task: string, model: string, opts?: unknown) => Promise<unknown>)
    | undefined,
}));

// QNBS-v3: plain async fn over hoisted state — survives the global afterEach vi.restoreAllMocks()
//          that would neuter a vi.fn().mockResolvedValue(...) implementation between tests.
const tabLeaderState = vi.hoisted(() => ({ result: true }));

vi.mock('../../packages/ai-core/node_modules/@mlc-ai/web-llm/lib/index.js', () => ({
  CreateMLCEngine: async (...args: unknown[]) => {
    if (typeof mlcState.engineFn !== 'function') {
      throw new Error('CreateMLCEngine not installed');
    }
    return mlcState.engineFn(...args);
  },
}));

vi.mock(
  '../../packages/ai-core/node_modules/@huggingface/transformers/dist/transformers.web.js',
  () => ({
    get pipeline() {
      return xenovaState.pipelineImpl;
    },
    env: { backends: { onnx: { wasm: { proxy: true } } } },
  }),
);

vi.mock('../../packages/ai-core/src/tabLeaderElection', () => ({
  electSingleHeavyInferenceTab: async () => tabLeaderState.result,
  surrenderLeadership: vi.fn(),
}));

// QNBS-v3: detectWebGpuSupport() checks 'gpu' in navigator. jsdom rejects stubGlobal/defineProperty on
//          globalThis.navigator, but defineProperty on the bare `navigator` works (proven pattern).
function addNavigatorGpu(): void {
  Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true, writable: true });
}

function removeNavigatorGpu(): void {
  try {
    delete (navigator as unknown as Record<string, unknown>)['gpu'];
  } catch {
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
}

describe('runLocalTextGeneration', () => {
  beforeEach(() => {
    mlcState.engineFn = undefined;
    xenovaState.pipelineImpl = undefined;
    tabLeaderState.result = true;
    removeNavigatorGpu();
  });

  afterEach(() => {
    removeNavigatorGpu();
  });

  it('returns heuristic fallback for empty prompt', async () => {
    const { runLocalTextGeneration } = await import('../../packages/ai-core/src/index');
    const result = await runLocalTextGeneration('   ');
    expect(result.layer).toBe('heuristic');
    expect(result.text).toBe('Heuristic fallback response');
  });

  it('returns heuristic fallback when all layers fail', async () => {
    // No WebGPU (navigator.gpu absent), no transformers pipeline → every layer skipped.
    const { runLocalTextGeneration } = await import('../../packages/ai-core/src/index');
    const result = await runLocalTextGeneration('Hello world');
    expect(result.layer).toBe('heuristic');
    expect(result.text).toContain('Hello world');
  });

  it('throws when AbortSignal is already aborted', async () => {
    const { runLocalTextGeneration } = await import('../../packages/ai-core/src/index');
    const controller = new AbortController();
    controller.abort();
    await expect(
      runLocalTextGeneration('test', undefined, undefined, controller.signal),
    ).rejects.toThrow('Aborted');
  });

  it('uses WebLLM layer when CreateMLCEngine succeeds', async () => {
    addNavigatorGpu();
    mlcState.engineFn = async () => ({
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '  WebLLM response  ' } }] }),
        },
      },
    });
    const { runLocalTextGeneration } = await import('../../packages/ai-core/src/index');
    const result = await runLocalTextGeneration('test prompt', 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
    expect(result.layer).toBe('webllm');
    expect(result.text).toBe('WebLLM response');
  });

  it('falls through to ONNX layer when WebLLM fails', async () => {
    addNavigatorGpu();
    mlcState.engineFn = async () => {
      throw new Error('WebGPU unavailable');
    };
    // QNBS-v3: pipeline returns a generator fn that echoes prompt + completion; the prompt prefix is
    //          stripped by runTransformersLayer, leaving 'ONNX generated'.
    xenovaState.pipelineImpl = async () => async () => [
      { generated_text: 'test promptONNX generated' },
    ];
    const { runLocalTextGeneration } = await import('../../packages/ai-core/src/index');
    const result = await runLocalTextGeneration('test prompt');
    expect(result.layer).toBe('onnx');
    expect(result.text).toBe('ONNX generated');
  });

  it('calls onProgress during WebLLM init', async () => {
    addNavigatorGpu();
    const progressReports: Array<{ progress: number; text: string }> = [];
    mlcState.engineFn = async (...args: unknown[]) => {
      const init = args[1] as { initProgressCallback?: (p: unknown) => void } | undefined;
      init?.initProgressCallback?.({ progress: 0.5, text: 'Loading weights…' });
      return {
        chat: {
          completions: {
            create: async () => ({ choices: [{ message: { content: 'done' } }] }),
          },
        },
      };
    };
    const { runLocalTextGeneration } = await import('../../packages/ai-core/src/index');
    await runLocalTextGeneration('hi', undefined, (r) => progressReports.push(r));
    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[0]).toMatchObject({ progress: 0.5, text: 'Loading weights…' });
  });

  it('does not call onProgress when signal is aborted', async () => {
    addNavigatorGpu();
    const progressReports: Array<{ progress: number; text: string }> = [];
    const controller = new AbortController();
    mlcState.engineFn = async (...args: unknown[]) => {
      const init = args[1] as { initProgressCallback?: (p: unknown) => void } | undefined;
      // Abort before the progress callback fires — the wrapper must short-circuit.
      controller.abort();
      init?.initProgressCallback?.({ progress: 0.5, text: 'Loading weights…' });
      return {
        chat: {
          completions: {
            create: async () => ({ choices: [{ message: { content: 'done' } }] }),
          },
        },
      };
    };
    const { runLocalTextGeneration } = await import('../../packages/ai-core/src/index');
    // QNBS-v3: after the aborted callback, the layer re-checks signal and throws 'Aborted'.
    await expect(
      runLocalTextGeneration('hi', undefined, (r) => progressReports.push(r), controller.signal),
    ).rejects.toThrow('Aborted');
    expect(progressReports.length).toBe(0);
  });
});

describe('WorkerBus', () => {
  it('enqueues and dequeues tasks in priority order', async () => {
    const { WorkerBus } = await import('../../packages/ai-core/src/index');
    const bus = new WorkerBus();
    bus.enqueue({ id: '1', type: 't', payload: {}, priority: 'low', createdAt: 0 });
    bus.enqueue({ id: '2', type: 't', payload: {}, priority: 'high', createdAt: 0 });
    const next = bus.dequeue();
    expect(next?.id).toBe('2');
  });

  it('rejects non-critical tasks when backpressured', async () => {
    const { WorkerBus } = await import('../../packages/ai-core/src/index');
    const bus = new WorkerBus();
    // Fill the queue past the 32-task limit
    for (let i = 0; i < 32; i++) {
      bus.enqueue({ id: String(i), type: 't', payload: {}, priority: 'normal', createdAt: 0 });
    }
    const rejected = bus.enqueue({
      id: 'overflow',
      type: 't',
      payload: {},
      priority: 'normal',
      createdAt: 0,
    });
    expect(rejected).toBe(false);
    // Critical tasks always bypass
    const critical = bus.enqueue({
      id: 'crit',
      type: 't',
      payload: {},
      priority: 'critical',
      createdAt: 0,
    });
    expect(critical).toBe(true);
  });

  it('cancels queued and in-flight tasks', async () => {
    const { WorkerBus } = await import('../../packages/ai-core/src/index');
    const bus = new WorkerBus();
    bus.enqueue({ id: 'queued', type: 't', payload: {}, priority: 'normal', createdAt: 0 });
    expect(bus.cancel('queued')).toBe(true);
    // In-flight
    const task = bus.dequeue();
    if (task) {
      bus.registerTask(task.id);
      expect(bus.cancel(task.id)).toBe(true);
    }
  });

  it('promotes low-priority tasks after MAX_PREEMPTIONS', async () => {
    const { WorkerBus } = await import('../../packages/ai-core/src/index');
    const bus = new WorkerBus();
    bus.enqueue({
      id: 'starved',
      type: 't',
      payload: {},
      priority: 'low',
      createdAt: 0,
      requeueCount: 3,
    });
    const tele = bus.getTelemetry();
    // The promoted task is in the normal queue now
    expect(tele.queueDepth.low).toBe(0);
  });
});
