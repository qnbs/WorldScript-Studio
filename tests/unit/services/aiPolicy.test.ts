/**
 * Tests for services/ai/aiPolicy.ts
 * QNBS-v3: Covers both sync and async enforcement — local providers bypass, cloud providers
 *          respect localStorageOnly and euDataResidency flags.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadSettings = vi.fn();

vi.mock('../../../services/storageService', () => ({
  storageService: {
    loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { assertCloudAiAllowed, assertCloudAiAllowedSync } from '../../../services/ai/aiPolicy';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aiPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSettings.mockResolvedValue({
      privacy: { localStorageOnly: false, euDataResidency: false },
    });
  });

  describe('assertCloudAiAllowedSync', () => {
    it('allows ollama (local)', () => {
      expect(() => assertCloudAiAllowedSync('ollama', undefined)).not.toThrow();
    });

    it('allows webllm (local)', () => {
      expect(() => assertCloudAiAllowedSync('webllm', undefined)).not.toThrow();
    });

    it('allows gemini when privacy is undefined', () => {
      expect(() => assertCloudAiAllowedSync('gemini', undefined)).not.toThrow();
    });

    it('throws when localStorageOnly is true for cloud provider', () => {
      expect(() =>
        assertCloudAiAllowedSync('gemini', {
          localStorageOnly: true,
          euDataResidency: false,
          analyticsEnabled: false,
          dataEncryption: true,
        }),
      ).toThrow('local-only mode');
    });

    it('throws when euDataResidency is true for grok', () => {
      expect(() =>
        assertCloudAiAllowedSync('grok', {
          localStorageOnly: false,
          euDataResidency: true,
          analyticsEnabled: false,
          dataEncryption: true,
        }),
      ).toThrow('EU residency');
    });

    it('throws when euDataResidency is true for openai', () => {
      expect(() =>
        assertCloudAiAllowedSync('openai', {
          localStorageOnly: false,
          euDataResidency: true,
          analyticsEnabled: false,
          dataEncryption: true,
        }),
      ).toThrow('EU residency');
    });

    it('allows gemini under euDataResidency (not grok/openai)', () => {
      expect(() =>
        assertCloudAiAllowedSync('gemini', {
          localStorageOnly: false,
          euDataResidency: true,
          analyticsEnabled: false,
          dataEncryption: true,
        }),
      ).not.toThrow();
    });
  });

  describe('assertCloudAiAllowed', () => {
    it('returns without calling loadSettings for ollama', async () => {
      await expect(assertCloudAiAllowed('ollama')).resolves.toBeUndefined();
      expect(mockLoadSettings).not.toHaveBeenCalled();
    });

    it('returns without calling loadSettings for webllm', async () => {
      await expect(assertCloudAiAllowed('webllm')).resolves.toBeUndefined();
      expect(mockLoadSettings).not.toHaveBeenCalled();
    });

    it('loads settings and allows gemini when not restricted', async () => {
      await expect(assertCloudAiAllowed('gemini')).resolves.toBeUndefined();
      expect(mockLoadSettings).toHaveBeenCalled();
    });

    it('throws when settings have localStorageOnly', async () => {
      mockLoadSettings.mockResolvedValue({
        privacy: { localStorageOnly: true, euDataResidency: false },
      });
      await expect(assertCloudAiAllowed('gemini')).rejects.toThrow('local-only mode');
    });
  });
});
