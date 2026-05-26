/**
 * Tests for services/ai/localBackendPresets.ts
 * QNBS-v3: Pure constant — verifies default URLs for each preset key.
 */

import { describe, expect, it } from 'vitest';
import { LOCAL_BACKEND_PRESET_DEFAULT_URL } from '../../../services/ai/localBackendPresets';

describe('LOCAL_BACKEND_PRESET_DEFAULT_URL', () => {
  it('ollama_default is localhost:11434', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.ollama_default).toBe('http://localhost:11434');
  });

  it('lm_studio is localhost:1234', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.lm_studio).toBe('http://localhost:1234');
  });

  it('vllm is localhost:8000', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.vllm).toBe('http://localhost:8000');
  });

  it('custom defaults to localhost:11434', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.custom).toBe('http://localhost:11434');
  });

  it('has exactly 4 presets', () => {
    expect(Object.keys(LOCAL_BACKEND_PRESET_DEFAULT_URL)).toHaveLength(4);
  });
});
