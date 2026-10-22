import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveAiMode } from '../../../services/ai/aiModeService';
import {
  assertCloudAiAllowed,
  assertCloudAiAllowedSync,
  assertLoraLocalOnly,
} from '../../../services/ai/aiPolicy';

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

describe('assertCloudAiAllowedSync — the AI mode is the only cloud authority (#818)', () => {
  // QNBS-v3: the suite mutates the singleton AI mode; reset it so a failing case cannot leak.
  afterEach(() => {
    setActiveAiMode('hybrid');
  });

  const CLOUD = ['gemini', 'openai', 'anthropic', 'grok', 'openrouter'] as const;

  it.each(['hybrid', 'cloud', 'local', 'eco'] as const)(
    'always allows local providers in %s mode',
    (mode) => {
      setActiveAiMode(mode);
      for (const provider of ['ollama', 'webllm', 'onnx', 'transformers'] as const) {
        expect(() => assertCloudAiAllowedSync(provider)).not.toThrow();
      }
    },
  );

  it.each(['hybrid', 'cloud'] as const)('allows every cloud provider in %s mode', (mode) => {
    setActiveAiMode(mode);
    for (const provider of CLOUD) {
      expect(() => assertCloudAiAllowedSync(provider)).not.toThrow();
    }
  });

  it.each(['local', 'eco'] as const)('blocks every cloud provider in %s mode', (mode) => {
    setActiveAiMode(mode);
    for (const provider of CLOUD) {
      expect(() => assertCloudAiAllowedSync(provider)).toThrow(`AI mode is "${mode}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// assertCloudAiAllowed (async)
// ---------------------------------------------------------------------------
describe('assertCloudAiAllowed', () => {
  afterEach(() => {
    setActiveAiMode('hybrid');
  });

  it('applies the same mode rule without loading stored settings', async () => {
    setActiveAiMode('local');
    await expect(assertCloudAiAllowed('gemini')).rejects.toThrow('local-only');
    await expect(assertCloudAiAllowed('ollama')).resolves.toBeUndefined();
    setActiveAiMode('hybrid');
    await expect(assertCloudAiAllowed('openai')).resolves.toBeUndefined();
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });
});
