/**
 * Branch-coverage tests for packages/ai-core/src/index.ts — runLocalTextGeneration fallback paths.
 * QNBS-v3: Relative-path mocks for workspace-scoped optionalDeps resolve to the same canonical
 *          realpath as the package-name import in source (pnpm symlink), so Vitest treats them as
 *          local-file mocks where vi.hoisted state IS shared with the factory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: Mutable state shared with relative-path mock factories via vi.hoisted
const mlcState = vi.hoisted(() => ({
  engineFn: undefined as ((...args: unknown[]) => Promise<unknown>) | undefined,
}));

// QNBS-v3: onnxState.hasCreate controls whether InferenceSession.create is a function —
//          false (default) → ONNX falls through to Transformers.js layer.
const onnxState = vi.hoisted(() => ({ hasCreate: false }));

// QNBS-v3: getter on mock object — evaluated at destructuring time in source, so flipping
//          hasPipeline before calling runLocalTextGeneration controls the typeof check.
const xenovaState = vi.hoisted(() => ({ hasPipeline: true }));

const tabLeaderState = vi.hoisted(() => ({ result: true }));

// QNBS-v3: Relative path for onnxruntime-web — resolves same canonical path as the dynamic import in source.
//          InferenceSession.create is undefined by default → ONNX layer falls through.
vi.mock('../../packages/ai-core/node_modules/onnxruntime-web/dist/ort.node.min.mjs', () => ({
  InferenceSession: {
    get create() {
      return onnxState.hasCreate ? () => Promise.resolve({}) : undefined;
    },
  },
}));

// QNBS-v3: Relative path → local-file mock scope → vi.hoisted mlcState visible in factory.
vi.mock('../../packages/ai-core/node_modules/@mlc-ai/web-llm/lib/index.js', () => ({
  CreateMLCEngine: async (...args: unknown[]) => {
    if (typeof mlcState.engineFn !== 'function') {
      throw new Error('CreateMLCEngine not installed');
    }
    return mlcState.engineFn(...args);
  },
}));

// QNBS-v3: Relative path → local-file mock scope → getter reads xenovaState at destructuring time.
vi.mock('../../packages/ai-core/node_modules/@xenova/transformers/src/transformers.js', () => ({
  get pipeline() {
    return xenovaState.hasPipeline ? () => undefined : undefined;
  },
}));

vi.mock('../../packages/ai-core/src/tabLeaderElection', () => ({
  electSingleHeavyInferenceTab: async () => tabLeaderState.result,
}));

import { runLocalTextGeneration, sanitizeForPrompt } from '@domain/ai-core';

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
    onnxState.hasCreate = false;
    xenovaState.hasPipeline = true;
    tabLeaderState.result = true;
    removeNavigatorGpu();
  });

  afterEach(() => {
    removeNavigatorGpu();
  });

  it('empty / whitespace prompt → heuristic fallback', async () => {
    const result = await runLocalTextGeneration('   ');
    expect(result.layer).toBe('heuristic');
    expect(result.text).toContain('Heuristic');
  });

  it('no WebGPU + pipeline is a function → layer:transformers available message', async () => {
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('transformers');
    expect(result.text).toContain('Transformers.js pipeline available');
  });

  it('no WebGPU + pipeline not a function → layer:transformers placeholder', async () => {
    xenovaState.hasPipeline = false;
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('transformers');
    expect(result.text).toContain('Transformers placeholder');
  });

  it('no WebGPU + ONNX InferenceSession.create available → layer:onnx', async () => {
    onnxState.hasCreate = true;
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('onnx');
    expect(result.text).toContain('ONNX Runtime Web');
  });

  it('WebGPU + not tab leader → tab-lock message', async () => {
    addNavigatorGpu();
    tabLeaderState.result = false;
    const result = await runLocalTextGeneration('write something');
    expect(result.layer).toBe('webllm');
    expect(result.text).toContain('Another StoryCraft tab');
  });

  it('WebGPU + CreateMLCEngine throws → catch → webllm unavailable message', async () => {
    addNavigatorGpu();
    // Default: mlcState.engineFn = undefined → wrapper throws → catch → unavailable
    const result = await runLocalTextGeneration('write a story');
    expect(result.layer).toBe('webllm');
    expect(result.text).toContain('@mlc-ai/web-llm');
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

  it('WebGPU + engine returns empty content → if(text) false → unavailable message', async () => {
    addNavigatorGpu();
    mlcState.engineFn = async () => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '' } }],
          }),
        },
      },
    });
    const result = await runLocalTextGeneration('start a story');
    expect(result.layer).toBe('webllm');
    expect(result.text).toContain('@mlc-ai/web-llm');
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
