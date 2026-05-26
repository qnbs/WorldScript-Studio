/**
 * Tests for services/ai/orchestrationProviders.ts
 * QNBS-v3: Pure constants and type guards — provider classification helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  isLocalInferenceProvider,
  isOrchestrationReadyProvider,
  LOCAL_INFERENCE_PROVIDERS,
  ORCHESTRATION_READY_PROVIDERS,
} from '../../../services/ai/orchestrationProviders';

describe('ORCHESTRATION_READY_PROVIDERS', () => {
  it('includes gemini', () => {
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('gemini');
  });

  it('includes openai', () => {
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('openai');
  });

  it('includes ollama', () => {
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('ollama');
  });

  it('has exactly 3 providers', () => {
    expect(ORCHESTRATION_READY_PROVIDERS).toHaveLength(3);
  });
});

describe('LOCAL_INFERENCE_PROVIDERS', () => {
  it('includes webllm', () => {
    expect(LOCAL_INFERENCE_PROVIDERS).toContain('webllm');
  });

  it('includes onnx', () => {
    expect(LOCAL_INFERENCE_PROVIDERS).toContain('onnx');
  });

  it('includes transformers', () => {
    expect(LOCAL_INFERENCE_PROVIDERS).toContain('transformers');
  });

  it('has exactly 3 providers', () => {
    expect(LOCAL_INFERENCE_PROVIDERS).toHaveLength(3);
  });
});

describe('isOrchestrationReadyProvider', () => {
  it('returns true for gemini', () => {
    expect(isOrchestrationReadyProvider('gemini')).toBe(true);
  });

  it('returns true for openai', () => {
    expect(isOrchestrationReadyProvider('openai')).toBe(true);
  });

  it('returns true for ollama', () => {
    expect(isOrchestrationReadyProvider('ollama')).toBe(true);
  });

  it('returns false for webllm', () => {
    expect(isOrchestrationReadyProvider('webllm')).toBe(false);
  });

  it('returns false for onnx', () => {
    expect(isOrchestrationReadyProvider('onnx')).toBe(false);
  });
});

describe('isLocalInferenceProvider', () => {
  it('returns true for webllm', () => {
    expect(isLocalInferenceProvider('webllm')).toBe(true);
  });

  it('returns true for onnx', () => {
    expect(isLocalInferenceProvider('onnx')).toBe(true);
  });

  it('returns true for transformers', () => {
    expect(isLocalInferenceProvider('transformers')).toBe(true);
  });

  it('returns false for gemini', () => {
    expect(isLocalInferenceProvider('gemini')).toBe(false);
  });

  it('returns false for openai', () => {
    expect(isLocalInferenceProvider('openai')).toBe(false);
  });
});
