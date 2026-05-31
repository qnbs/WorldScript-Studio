import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectOnnxExecutionProviders,
  listCachedOnnxSessions,
  releaseAllOnnxSessions,
} from '../../packages/ai-core/src/onnxRuntimeEngine';

describe('onnxRuntimeEngine', () => {
  beforeEach(() => {
    releaseAllOnnxSessions();
  });

  describe('detectOnnxExecutionProviders', () => {
    it('includes wasm always', async () => {
      const eps = await detectOnnxExecutionProviders();
      expect(eps).toContain('wasm');
    });

    it('includes webgpu when navigator.gpu exists', async () => {
      Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true, writable: true });
      const eps = await detectOnnxExecutionProviders();
      expect(eps).toContain('webgpu');
    });
  });

  it('starts with empty cache', () => {
    expect(listCachedOnnxSessions().length).toBe(0);
  });

  it('releaseAll is idempotent', () => {
    expect(() => releaseAllOnnxSessions()).not.toThrow();
    expect(listCachedOnnxSessions().length).toBe(0);
  });
});
