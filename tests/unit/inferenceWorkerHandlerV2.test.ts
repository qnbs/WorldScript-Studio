// @vitest-environment jsdom
// QNBS-v3: [Parity gate for the v2 inference worker handler (docs/adr/0014) — catches drift from v1 before any consumer cuts over; named distinctly from tests/unit/inferenceWorker.test.ts until v1 is deleted.]

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerHandlerContext } from '../../packages/worker-bus/src/workerBootstrap';

const { mockPipelineFactory } = vi.hoisted(() => ({ mockPipelineFactory: vi.fn() }));

vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipelineFactory,
}));

// QNBS-v3: [Imported after the mock is declared so the worker picks up the mocked factory.]
import { handleInference } from '../../workers/v2/inference.worker';

function makeCtx(overrides: Partial<WorkerHandlerContext> = {}): WorkerHandlerContext {
  return {
    taskId: 't1',
    taskType: 'inference.embed',
    payload: { task: 'feature-extraction', modelId: 'm', input: 'hello world' },
    signal: new AbortController().signal,
    emitProgress: vi.fn(),
    ...overrides,
  };
}

describe('inference.worker (v2) handleInference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws Aborted when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(handleInference(makeCtx({ signal: controller.signal }))).rejects.toThrow(
      'Aborted',
    );
    expect(mockPipelineFactory).not.toHaveBeenCalled();
  });

  it('throws Aborted when the signal aborts between model load and inference', async () => {
    const controller = new AbortController();
    const pipe = vi.fn();
    mockPipelineFactory.mockImplementation(async () => {
      controller.abort();
      return pipe;
    });

    await expect(
      handleInference(
        makeCtx({
          signal: controller.signal,
          payload: { task: 'feature-extraction', modelId: 'abort-model', input: 'x' },
        }),
      ),
    ).rejects.toThrow('Aborted');
    expect(pipe).not.toHaveBeenCalled();
  });

  it('feature-extraction: normalizes a Float32Array result to a flat number[]', async () => {
    const pipe = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));
    mockPipelineFactory.mockResolvedValue(pipe);
    const emitProgress = vi.fn();

    const result = await handleInference(
      makeCtx({
        payload: { task: 'feature-extraction', modelId: 'embed-1', input: 'x' },
        emitProgress,
      }),
    );

    expect(result).toEqual([Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)]);
    expect(pipe).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ pooling: 'mean', normalize: true }),
    );
    expect(emitProgress).toHaveBeenNthCalledWith(1, 'loading', 0.2, 'Loading model');
    expect(emitProgress).toHaveBeenNthCalledWith(2, 'inference', 0.6, 'Running inference');
    expect(emitProgress).toHaveBeenNthCalledWith(3, 'done', 1.0, 'Complete');
  });

  it('feature-extraction: normalizes a {data: Float32Array} result to a flat number[]', async () => {
    const pipe = vi.fn().mockResolvedValue({ data: new Float32Array([1, 2]) });
    mockPipelineFactory.mockResolvedValue(pipe);

    const result = await handleInference(
      makeCtx({ payload: { task: 'feature-extraction', modelId: 'embed-2', input: 'x' } }),
    );

    expect(result).toEqual([1, 2]);
  });

  it('feature-extraction: normalizes a plain iterable result to a flat number[]', async () => {
    const pipe = vi.fn().mockResolvedValue([4, 5, 6]);
    mockPipelineFactory.mockResolvedValue(pipe);

    const result = await handleInference(
      makeCtx({ payload: { task: 'feature-extraction', modelId: 'embed-3', input: 'x' } }),
    );

    expect(result).toEqual([4, 5, 6]);
  });

  it('sentiment-analysis: returns "LABEL:score" formatted to 4 decimals', async () => {
    const pipe = vi.fn().mockResolvedValue([{ label: 'POSITIVE', score: 0.5 }]);
    mockPipelineFactory.mockResolvedValue(pipe);

    const result = await handleInference(
      makeCtx({ payload: { task: 'sentiment-analysis', modelId: 'sent-1', input: 'great!' } }),
    );

    expect(result).toBe('POSITIVE:0.5000');
    expect(pipe).toHaveBeenCalledWith('great!', {});
  });

  it('sentiment-analysis: defaults to NEUTRAL:0.0000 when the pipeline result is empty', async () => {
    const pipe = vi.fn().mockResolvedValue([]);
    mockPipelineFactory.mockResolvedValue(pipe);

    const result = await handleInference(
      makeCtx({ payload: { task: 'sentiment-analysis', modelId: 'sent-2', input: 'x' } }),
    );

    expect(result).toBe('NEUTRAL:0.0000');
  });

  it('summarization: returns summary_text', async () => {
    const pipe = vi.fn().mockResolvedValue([{ summary_text: 'a short summary' }]);
    mockPipelineFactory.mockResolvedValue(pipe);

    const result = await handleInference(
      makeCtx({ payload: { task: 'summarization', modelId: 'sum-1', input: 'long text...' } }),
    );

    expect(result).toBe('a short summary');
  });

  it('text-generation: returns generated_text', async () => {
    const pipe = vi.fn().mockResolvedValue([{ generated_text: 'once upon a time' }]);
    mockPipelineFactory.mockResolvedValue(pipe);

    const result = await handleInference(
      makeCtx({ payload: { task: 'text-generation', modelId: 'gen-1', input: 'prompt' } }),
    );

    expect(result).toBe('once upon a time');
  });

  it('passes inferenceOptions through to the pipeline call for non-embedding tasks', async () => {
    const pipe = vi.fn().mockResolvedValue([{ generated_text: 'x' }]);
    mockPipelineFactory.mockResolvedValue(pipe);

    await handleInference(
      makeCtx({
        payload: {
          task: 'text-generation',
          modelId: 'gen-2',
          input: 'prompt',
          inferenceOptions: { max_new_tokens: 32 },
        },
      }),
    );

    expect(pipe).toHaveBeenCalledWith('prompt', { max_new_tokens: 32 });
  });
});
