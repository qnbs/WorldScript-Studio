import { describe, expect, it } from 'vitest';
import {
  isOrchestrationReadyProvider,
  ORCHESTRATION_READY_PROVIDERS,
} from '../../../services/ai/orchestrationProviders';

describe('ORCHESTRATION_READY_PROVIDERS', () => {
  it('contains gemini, openai, and ollama', () => {
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('gemini');
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('openai');
    expect(ORCHESTRATION_READY_PROVIDERS).toContain('ollama');
  });

  it('does not include webllm or grok', () => {
    expect(ORCHESTRATION_READY_PROVIDERS).not.toContain('webllm');
    expect(ORCHESTRATION_READY_PROVIDERS).not.toContain('grok');
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

  it('returns false for grok', () => {
    expect(isOrchestrationReadyProvider('grok')).toBe(false);
  });
});
