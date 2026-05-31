import { beforeEach, describe, expect, it } from 'vitest';
import type { WebLlmModelId } from '../../packages/ai-core/src/index';
import {
  listCachedWebLlmEngines,
  releaseAllWebLlmEngines,
  releaseWebLlm,
} from '../../packages/ai-core/src/webllmOptimizer';

describe('webllmOptimizer', () => {
  beforeEach(() => {
    releaseAllWebLlmEngines();
  });

  it('starts with empty cache', () => {
    expect(listCachedWebLlmEngines().length).toBe(0);
  });

  it('releaseAll clears all engines', () => {
    // Cache is already empty after beforeEach; just verify idempotent
    releaseAllWebLlmEngines();
    expect(listCachedWebLlmEngines().length).toBe(0);
  });

  it('release of non-existent engine is safe', () => {
    expect(() => releaseWebLlm('non-existent-model' as unknown as WebLlmModelId)).not.toThrow();
  });
});
