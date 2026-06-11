/**
 * Tests for services/ai/aiModeService.ts
 * QNBS-v3: Verifies shouldRouteLocally() per mode, cold-start seed, eco bridge,
 * notifyLocalModelsReady() behavior, OpenRouter helpers, and getLocalFallbackModel().
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  getActiveAiMode,
  getLocalFallbackModel,
  getLocalModelsReady,
  getOpenRouterFallbackProvider,
  getOpenRouterModel,
  isCloudOnlyMode,
  isEcoMode,
  notifyLocalModelsReady,
  setActiveAiMode,
  setOpenRouterConfig,
  shouldRouteLocally,
  shouldUseOpenRouter,
} from '../../../services/ai/aiModeService';

// Reset to defaults after each test to avoid cross-test pollution.
afterEach(() => {
  setActiveAiMode('hybrid');
  notifyLocalModelsReady(false);
  setOpenRouterConfig(false, 'deepseek/deepseek-r1:free');
});

describe('shouldRouteLocally()', () => {
  it('returns true for local mode (always local)', () => {
    setActiveAiMode('local');
    expect(shouldRouteLocally()).toBe(true);
  });

  it('returns true for eco mode (always local)', () => {
    setActiveAiMode('eco');
    expect(shouldRouteLocally()).toBe(true);
  });

  it('returns false for cloud mode when online', () => {
    setActiveAiMode('cloud');
    // navigator.onLine is true in jsdom by default
    expect(shouldRouteLocally()).toBe(false);
  });

  it('returns false for hybrid mode when online and local models not loaded', () => {
    setActiveAiMode('hybrid');
    notifyLocalModelsReady(false);
    expect(shouldRouteLocally()).toBe(false);
  });

  it('returns false for hybrid mode even when local models ARE ready (cloud-first decision)', () => {
    setActiveAiMode('hybrid');
    notifyLocalModelsReady(true);
    // Hybrid is cloud-first: _localModelsReady does NOT promote to local while online.
    expect(shouldRouteLocally()).toBe(false);
  });
});

describe('notifyLocalModelsReady() / getLocalModelsReady()', () => {
  it('getLocalModelsReady() starts false', () => {
    expect(getLocalModelsReady()).toBe(false);
  });

  it('reflects true after notifyLocalModelsReady(true)', () => {
    notifyLocalModelsReady(true);
    expect(getLocalModelsReady()).toBe(true);
  });

  it('reverts to false after notifyLocalModelsReady(false)', () => {
    notifyLocalModelsReady(true);
    notifyLocalModelsReady(false);
    expect(getLocalModelsReady()).toBe(false);
  });
});

describe('getActiveAiMode() / setActiveAiMode()', () => {
  it('defaults to hybrid', () => {
    expect(getActiveAiMode()).toBe('hybrid');
  });

  it('reflects mode after setActiveAiMode()', () => {
    setActiveAiMode('eco');
    expect(getActiveAiMode()).toBe('eco');
  });
});

describe('isEcoMode() / isCloudOnlyMode()', () => {
  it('isEcoMode() true when eco', () => {
    setActiveAiMode('eco');
    expect(isEcoMode()).toBe(true);
  });

  it('isEcoMode() false for other modes', () => {
    setActiveAiMode('hybrid');
    expect(isEcoMode()).toBe(false);
    setActiveAiMode('cloud');
    expect(isEcoMode()).toBe(false);
  });

  it('isCloudOnlyMode() true for cloud when online', () => {
    setActiveAiMode('cloud');
    expect(isCloudOnlyMode()).toBe(true);
  });

  it('isCloudOnlyMode() false for non-cloud modes', () => {
    setActiveAiMode('hybrid');
    expect(isCloudOnlyMode()).toBe(false);
  });
});

describe('getLocalFallbackModel()', () => {
  it('returns SmolLM2 for eco mode', () => {
    setActiveAiMode('eco');
    expect(getLocalFallbackModel()).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
  });

  it('returns Llama 3.2 1B for local mode', () => {
    setActiveAiMode('local');
    expect(getLocalFallbackModel()).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
  });

  it('returns Llama 3.2 1B for hybrid mode', () => {
    setActiveAiMode('hybrid');
    expect(getLocalFallbackModel()).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
  });
});

describe('OpenRouter helpers', () => {
  it('shouldUseOpenRouter() false when disabled', () => {
    setOpenRouterConfig(false, 'deepseek/deepseek-r1:free');
    expect(shouldUseOpenRouter()).toBe(false);
  });

  it('shouldUseOpenRouter() true when enabled and mode is hybrid', () => {
    setOpenRouterConfig(true, 'deepseek/deepseek-r1:free');
    setActiveAiMode('hybrid');
    expect(shouldUseOpenRouter()).toBe(true);
  });

  it('shouldUseOpenRouter() false when enabled but mode is local', () => {
    setOpenRouterConfig(true, 'deepseek/deepseek-r1:free');
    setActiveAiMode('local');
    expect(shouldUseOpenRouter()).toBe(false);
  });

  it('getOpenRouterModel() returns configured model', () => {
    setOpenRouterConfig(true, 'meta-llama/llama-3.3-70b-instruct:free');
    expect(getOpenRouterModel()).toBe('meta-llama/llama-3.3-70b-instruct:free');
  });

  it('getOpenRouterModel() defaults to DeepSeek R1 free when model empty', () => {
    setOpenRouterConfig(true, '');
    expect(getOpenRouterModel()).toBe('deepseek/deepseek-r1:free');
  });

  it('getOpenRouterFallbackProvider() returns webllm for eco', () => {
    setActiveAiMode('eco');
    expect(getOpenRouterFallbackProvider()).toBe('webllm');
  });

  it('getOpenRouterFallbackProvider() returns gemini for cloud', () => {
    setActiveAiMode('cloud');
    expect(getOpenRouterFallbackProvider()).toBe('gemini');
  });

  it('getOpenRouterFallbackProvider() returns gemini for hybrid', () => {
    setActiveAiMode('hybrid');
    expect(getOpenRouterFallbackProvider()).toBe('gemini');
  });
});
