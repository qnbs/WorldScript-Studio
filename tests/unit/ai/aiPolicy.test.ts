import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveAiMode } from '../../../services/ai/aiModeService';
import {
  assertCloudAiAllowed,
  assertCloudAiAllowedSync,
  assertLoraLocalOnly,
} from '../../../services/ai/aiPolicy';
import type { PrivacySettings } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadSettings = vi.fn();

vi.mock('../../../services/storageService', () => ({
  storageService: {
    loadSettings: () => mockLoadSettings(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSettings.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// assertCloudAiAllowedSync
// ---------------------------------------------------------------------------
describe('assertLoraLocalOnly', () => {
  it('allows local provider names', () => {
    expect(() => assertLoraLocalOnly('ollama')).not.toThrow();
    expect(() => assertLoraLocalOnly('webllm')).not.toThrow();
    expect(() => assertLoraLocalOnly('onnx')).not.toThrow();
    expect(() => assertLoraLocalOnly('transformers')).not.toThrow();
  });

  it('allows Unsloth model IDs', () => {
    expect(() => assertLoraLocalOnly('unsloth/llama-3-8b')).not.toThrow();
  });

  it('allows HuggingFace IDs without cloud markers', () => {
    expect(() => assertLoraLocalOnly('HuggingFaceTB/SmolLM2-135M-Instruct')).not.toThrow();
  });

  it('throws for Google/OpenAI cloud markers', () => {
    expect(() => assertLoraLocalOnly('models/googleapis/gemini')).toThrow('cloud-hosted');
    expect(() => assertLoraLocalOnly('openai/gpt-4')).toThrow('cloud-hosted');
  });
});

describe('assertCloudAiAllowedSync', () => {
  // QNBS-v3: Guaranteed teardown — this suite mutates the singleton AI mode; reset it to the
  // default 'hybrid' after every test so an early-failing assertion can't leak the wrong mode
  // into later tests and cause cascading false failures.
  afterEach(() => {
    setActiveAiMode('hybrid');
  });

  it('does not throw for ollama (local provider)', () => {
    expect(() => assertCloudAiAllowedSync('ollama', undefined)).not.toThrow();
  });

  it('does not throw for webllm (local provider)', () => {
    expect(() => assertCloudAiAllowedSync('webllm', undefined)).not.toThrow();
  });

  it('does not throw for gemini when no privacy settings', () => {
    expect(() => assertCloudAiAllowedSync('gemini', undefined)).not.toThrow();
  });

  it('does not throw for gemini when localStorageOnly is false', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: false,
      analyticsEnabled: false,
      dataEncryption: true,
    };
    expect(() => assertCloudAiAllowedSync('gemini', privacy)).not.toThrow();
  });

  it('throws when localStorageOnly is true for a cloud provider', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: true,
      euDataResidency: false,
      analyticsEnabled: false,
      dataEncryption: true,
    };
    expect(() => assertCloudAiAllowedSync('gemini', privacy)).toThrow(
      'Cloud provider blocked: local-only mode is active.',
    );
  });

  it('throws for openai when euDataResidency is true', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: true,
      analyticsEnabled: false,
      dataEncryption: true,
    };
    expect(() => assertCloudAiAllowedSync('openai', privacy)).toThrow(
      'Cloud provider blocked by EU residency policy: openai',
    );
  });

  it('throws for grok when euDataResidency is true', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: true,
      analyticsEnabled: false,
      dataEncryption: true,
    };
    expect(() => assertCloudAiAllowedSync('grok', privacy)).toThrow(
      'Cloud provider blocked by EU residency policy: grok',
    );
  });

  it('throws for cloud provider when AI mode is local', () => {
    setActiveAiMode('local');
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: false,
      analyticsEnabled: false,
      dataEncryption: true,
    };
    expect(() => assertCloudAiAllowedSync('gemini', privacy)).toThrow('local-only');
  });

  it('does not throw for gemini when only euDataResidency is true', () => {
    // QNBS-v3: EU residency only blocks grok and openai, not gemini/anthropic
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: true,
      analyticsEnabled: false,
      dataEncryption: true,
    };
    expect(() => assertCloudAiAllowedSync('gemini', privacy)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// assertCloudAiAllowed (async)
// ---------------------------------------------------------------------------
describe('assertCloudAiAllowed', () => {
  it('resolves without throwing for local providers (no storage call)', async () => {
    await expect(assertCloudAiAllowed('ollama')).resolves.toBeUndefined();
    await expect(assertCloudAiAllowed('webllm')).resolves.toBeUndefined();
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });

  it('loads settings and resolves for gemini when no restrictions', async () => {
    mockLoadSettings.mockResolvedValue({
      privacy: { localStorageOnly: false, euDataResidency: false },
    });
    await expect(assertCloudAiAllowed('gemini')).resolves.toBeUndefined();
    expect(mockLoadSettings).toHaveBeenCalled();
  });

  it('throws for gemini when settings have localStorageOnly', async () => {
    mockLoadSettings.mockResolvedValue({
      privacy: { localStorageOnly: true, euDataResidency: false },
    });
    await expect(assertCloudAiAllowed('gemini')).rejects.toThrow('local-only mode');
  });

  it('does not throw when settings are null (no privacy config)', async () => {
    mockLoadSettings.mockResolvedValue(null);
    await expect(assertCloudAiAllowed('gemini')).resolves.toBeUndefined();
  });
});
