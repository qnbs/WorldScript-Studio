/**
 * Tests for services/ai/providers/openrouterProvider.ts
 * QNBS-v3: Circuit breaker state, isOpenRouterFreeModel(), and isCircuitOpen() resets.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  getApproxRpm,
  isCircuitOpen,
  isOpenRouterFreeModel,
  OPENROUTER_FREE_MODELS,
  resetOpenRouterCircuit,
} from '../../../services/ai/providers/openrouterProvider';

afterEach(() => {
  resetOpenRouterCircuit();
});

describe('isOpenRouterFreeModel()', () => {
  it('returns true for :free suffix models', () => {
    expect(isOpenRouterFreeModel('deepseek/deepseek-r1:free')).toBe(true);
    expect(isOpenRouterFreeModel('meta-llama/llama-3.3-70b-instruct:free')).toBe(true);
  });

  it('returns false for paid models', () => {
    expect(isOpenRouterFreeModel('deepseek/deepseek-r1')).toBe(false);
    expect(isOpenRouterFreeModel('openai/gpt-4o')).toBe(false);
  });

  it('all OPENROUTER_FREE_MODELS entries are free models', () => {
    for (const model of OPENROUTER_FREE_MODELS) {
      expect(isOpenRouterFreeModel(model)).toBe(true);
    }
  });
});

describe('isCircuitOpen()', () => {
  it('starts closed', () => {
    expect(isCircuitOpen()).toBe(false);
  });

  it('resets to closed after resetOpenRouterCircuit()', () => {
    resetOpenRouterCircuit();
    expect(isCircuitOpen()).toBe(false);
  });
});

describe('getApproxRpm()', () => {
  it('returns a number ≥ 0', () => {
    expect(getApproxRpm()).toBeGreaterThanOrEqual(0);
  });
});
