// @vitest-environment jsdom
// QNBS-v3: P1-1 — unit tests for the WebLLM WorkerBus v2 handler. The handler runs inside the
//          worker; here we exercise its pure logic (WebGPU gate, progress emit, abort, result
//          shaping) with a mocked engine. Importing the worker module registers the handler
//          (pure Map insert) — safe in jsdom where `self` exists.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerHandlerContext } from '../../packages/worker-bus/src/workerBootstrap';

// QNBS-v3: vi.hoisted — the worker module is imported statically below, so the mock factory runs
//          during the hoisted import phase; a plain const would hit a TDZ ReferenceError.
const { mockGetWebLlmEngine } = vi.hoisted(() => ({ mockGetWebLlmEngine: vi.fn() }));

vi.mock('../../packages/ai-core/src/webllmOptimizer', () => ({
  getWebLlmEngine: mockGetWebLlmEngine,
}));

// QNBS-v3: imported AFTER the mock is declared so the worker picks up the mocked engine factory.
import { handleWebLlm } from '../../workers/v2/webllm.worker';

function setWebGpu(present: boolean): void {
  if (present) {
    Object.defineProperty(globalThis.navigator, 'gpu', { value: {}, configurable: true });
  } else if ('gpu' in globalThis.navigator) {
    delete (globalThis.navigator as { gpu?: unknown }).gpu;
  }
}

function makeCtx(overrides: Partial<WorkerHandlerContext> = {}): WorkerHandlerContext {
  return {
    taskId: 't1',
    taskType: 'inference.webllm',
    payload: { prompt: 'hello', modelId: 'm' },
    signal: new AbortController().signal,
    emitProgress: vi.fn(),
    ...overrides,
  };
}

function fakeEngine(content: string | null) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: content === null ? [{}] : [{ message: { content } }],
        }),
      },
    },
  };
}

describe('webllm.worker handleWebLlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWebGpu(false);
  });

  afterEach(() => {
    setWebGpu(false);
  });

  it('throws NO_WEBGPU when WebGPU is unavailable', async () => {
    await expect(handleWebLlm(makeCtx())).rejects.toThrow('NO_WEBGPU');
    expect(mockGetWebLlmEngine).not.toHaveBeenCalled();
  });

  it('throws Aborted when the signal is already aborted', async () => {
    setWebGpu(true);
    const controller = new AbortController();
    controller.abort();
    await expect(handleWebLlm(makeCtx({ signal: controller.signal }))).rejects.toThrow('Aborted');
  });

  it('throws WEBLLM_UNAVAILABLE when the engine cannot be created', async () => {
    setWebGpu(true);
    mockGetWebLlmEngine.mockResolvedValue(null);
    await expect(handleWebLlm(makeCtx())).rejects.toThrow('WEBLLM_UNAVAILABLE');
  });

  it('returns trimmed text and emits loading + done progress on success', async () => {
    setWebGpu(true);
    mockGetWebLlmEngine.mockImplementation(async (_id, opts) => {
      // Simulate model-load progress.
      opts?.onProgress?.({ progress: 0.4, text: 'downloading' });
      return fakeEngine('  generated answer  ');
    });
    const emitProgress = vi.fn();
    const result = await handleWebLlm(makeCtx({ emitProgress }));
    expect(result).toEqual({ text: 'generated answer', layer: 'webllm', modelId: 'm' });
    expect(emitProgress).toHaveBeenCalledWith('loading', 0.4, 'downloading');
    expect(emitProgress).toHaveBeenCalledWith('done', 1, 'Complete');
  });

  it('returns empty text when the completion is empty (caller will fall back)', async () => {
    setWebGpu(true);
    mockGetWebLlmEngine.mockResolvedValue(fakeEngine(null));
    const result = await handleWebLlm(makeCtx());
    expect(result.text).toBe('');
    expect(result.layer).toBe('webllm');
  });
});
