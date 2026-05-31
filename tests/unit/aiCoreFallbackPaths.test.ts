/**
 * Branch-coverage tests for packages/ai-core/src/index.ts — runLocalTextGeneration fallback paths.
 * QNBS-v3: Rewritten for the transformers.js v3 real-inference implementation
 *          (WebLLM → ONNX → Transformers.js → heuristic). Resolved-path mocks share the canonical
 *          realpath of the package-name dynamic imports in source (pnpm symlink), so vi.hoisted state
 *          IS visible to the factories. The previous version asserted removed placeholder messages
 *          ("Transformers.js pipeline available", direct onnxruntime-web InferenceSession) and is
 *          superseded by this real-inference behaviour + tests/unit/ai-core.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Mutable state shared with relative-path mock factories via vi.hoisted.
const mlcState = vi.hoisted(() => ({
  engineFn: undefined as ((...args: unknown[]) => Promise<unknown>) | undefined,
}));

// QNBS-v3: pipelineImpl drives the ONNX/Transformers layers: returns a generator fn, or undefined to
//          simulate "pipeline is not a function" (both inference layers skipped → heuristic).
const xenovaState = vi.hoisted(() => ({
  pipelineImpl: undefined as
    | ((task: string, model: string, opts?: unknown) => Promise<unknown>)
    | undefined,
}));

const tabLeaderState = vi.hoisted(() => ({ result: true }));

// QNBS-v3: Relative path → local-file mock scope → vi.hoisted mlcState visible in factory.
vi.mock('../../packages/ai-core/node_modules/@mlc-ai/web-llm/lib/index.js', () => ({
  CreateMLCEngine: async (...args: unknown[]) => {
    if (typeof mlcState.engineFn !== 'function') {
      throw new Error('CreateMLCEngine not installed');
    }
    return mlcState.engineFn(...args);
  },
}));

// QNBS-v3: Relative path → canonical realpath of the aliased `@huggingface/transformers` import.
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

import { runLocalTextGeneration, sanitizeForPrompt } from '@domain/ai-core';

// QNBS-v3: ONNX_SUPPORTED_MODELS[0].id — the model the ONNX (Layer-2) path requests.
const ONNX_MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addNavigatorGpu() {
  Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true, writable: true });
}

function removeNavigatorGpu() {
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

// ─── Branch-Tests ─────────────────────────────────────────────────────────────

describe('runLocalTextGeneration branches', () => {
  beforeEach(() => {
    mlcState.engineFn = undefined;
    xenovaState.pipelineImpl = undefined;
    tabLeaderState.result = true;
    removeNavigatorGpu();
  });

  afterEach(() => {
    removeNavigatorGpu();
  });

  it('empty / whitespace prompt → heuristic fallback', async () => {
    const result = await runLocalTextGeneration('   ');
    expect(result.layer).toBe('heuristic');
    expect(result.text).toBe('Heuristic fallback response');
  });

  it('no WebGPU + ONNX pipeline yields text → layer:onnx (prompt stripped)', async () => {
    xenovaState.pipelineImpl = async () => async (input: string) => [
      { generated_text: `${input} ONNX_OUT` },
    ];
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('onnx');
    expect(result.text).toBe('ONNX_OUT');
  });

  it('ONNX empty → falls through to Transformers.js layer → layer:transformers', async () => {
    xenovaState.pipelineImpl = async (_task: string, model: string) =>
      model === ONNX_MODEL
        ? async () => [{ generated_text: '' }]
        : async (input: string) => [{ generated_text: `${input} TF_OUT` }];
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('transformers');
    expect(result.text).toBe('TF_OUT');
  });

  it('no pipeline available → heuristic echo of the sanitized prompt', async () => {
    xenovaState.pipelineImpl = undefined; // typeof pipeline !== 'function' → skip ONNX + Transformers
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('heuristic');
    expect(result.text).toContain('write a story');
  });

  it('WebGPU + not tab leader → webllm tab-lock message', async () => {
    addNavigatorGpu();
    tabLeaderState.result = false;
    const result = await runLocalTextGeneration('write something');
    expect(result.layer).toBe('webllm');
    expect(result.text).toContain('Another StoryCraft tab');
  });

  it('WebGPU + engine returns text → layer:webllm', async () => {
    addNavigatorGpu();
    mlcState.engineFn = async () => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Once upon a time…' } }],
          }),
        },
      },
    });
    const result = await runLocalTextGeneration(
      'start a story',
      'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    );
    expect(result.layer).toBe('webllm');
    expect(result.text).toBe('Once upon a time…');
  });

  it('WebGPU + WebLLM throws + no pipeline → heuristic fallthrough', async () => {
    addNavigatorGpu();
    // Default: mlcState.engineFn = undefined → wrapper throws → catch → next layers (none) → heuristic.
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('heuristic');
  });

  it('onProgress callback receives {progress, text} from initProgressCallback', async () => {
    addNavigatorGpu();
    let capturedCb: ((p: unknown) => void) | undefined;
    mlcState.engineFn = async (...args: unknown[]) => {
      const init = args[1] as { initProgressCallback?: (p: unknown) => void } | undefined;
      capturedCb = init?.initProgressCallback;
      return {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: 'done' } }],
            }),
          },
        },
      };
    };
    const onProgress = vi.fn();
    await runLocalTextGeneration('hello', undefined, onProgress);
    capturedCb?.({ progress: 0.5, text: 'Loading model…' });
    expect(onProgress).toHaveBeenCalledWith({ progress: 0.5, text: 'Loading model…' });
  });
});

// ─── sanitizeForPrompt ────────────────────────────────────────────────────────

describe('sanitizeForPrompt', () => {
  it('truncates strings longer than 12 000 characters', () => {
    const long = 'a'.repeat(13_000);
    const result = sanitizeForPrompt(long);
    expect(result).toContain('…[truncated]');
    expect(result.length).toBeLessThan(long.length);
  });

  it('does not truncate strings ≤ 12 000 characters', () => {
    const exact = 'b'.repeat(12_000);
    const result = sanitizeForPrompt(exact);
    expect(result).not.toContain('[truncated]');
  });

  it('redacts email addresses', () => {
    const result = sanitizeForPrompt('Contact user@example.com for details');
    expect(result).toContain('[REDACTED_EMAIL]');
    expect(result).not.toContain('user@example.com');
  });
});
