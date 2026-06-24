/**
 * Tests for services/ai/aiPolicy.ts, creativityTemperature.ts, modelNormalization.ts.
 * QNBS-v3: Pure logic — no network, mocks storageService for async path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadSettings = vi.fn();

vi.mock('../../services/storageService', () => ({
  storageService: { loadSettings: (...args: unknown[]) => mockLoadSettings(...args) },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { assertCloudAiAllowed, assertCloudAiAllowedSync } from '../../services/ai/aiPolicy';
import { CREATIVITY_TO_TEMPERATURE } from '../../services/ai/creativityTemperature';
import {
  buildOpenRouterStyleHeaders,
  normalizeOllamaModelId,
  normalizeOpenAiCompatibleBaseUrl,
  resolveOpenAiCompatibleRoot,
} from '../../services/ai/modelNormalization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const basePrivacy = (overrides: { localStorageOnly: boolean; euDataResidency: boolean }) => ({
  analyticsEnabled: false,
  dataEncryption: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// aiPolicy — assertCloudAiAllowedSync
// ---------------------------------------------------------------------------

describe('assertCloudAiAllowedSync', () => {
  it('allows ollama regardless of privacy settings', () => {
    expect(() =>
      assertCloudAiAllowedSync(
        'ollama',
        basePrivacy({ localStorageOnly: true, euDataResidency: false }),
      ),
    ).not.toThrow();
  });

  it('allows webllm regardless of privacy settings', () => {
    expect(() =>
      assertCloudAiAllowedSync(
        'webllm',
        basePrivacy({ localStorageOnly: true, euDataResidency: false }),
      ),
    ).not.toThrow();
  });

  it('throws when localStorageOnly=true and provider is gemini', () => {
    expect(() =>
      assertCloudAiAllowedSync(
        'gemini',
        basePrivacy({ localStorageOnly: true, euDataResidency: false }),
      ),
    ).toThrow('Cloud provider blocked: local-only mode is active.');
  });

  it('throws when euDataResidency=true and provider is openai', () => {
    expect(() =>
      assertCloudAiAllowedSync(
        'openai',
        basePrivacy({ localStorageOnly: false, euDataResidency: true }),
      ),
    ).toThrow('EU residency policy');
  });

  it('throws when euDataResidency=true and provider is grok', () => {
    expect(() =>
      assertCloudAiAllowedSync(
        'grok',
        basePrivacy({ localStorageOnly: false, euDataResidency: true }),
      ),
    ).toThrow('EU residency policy');
  });

  it('allows gemini when euDataResidency=true (only openai/grok are blocked)', () => {
    expect(() =>
      assertCloudAiAllowedSync(
        'gemini',
        basePrivacy({ localStorageOnly: false, euDataResidency: true }),
      ),
    ).not.toThrow();
  });

  it('does not throw when privacy is undefined', () => {
    expect(() => assertCloudAiAllowedSync('gemini', undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// aiPolicy — assertCloudAiAllowed (async)
// ---------------------------------------------------------------------------

describe('assertCloudAiAllowed (async)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips storage for ollama', async () => {
    await expect(assertCloudAiAllowed('ollama')).resolves.not.toThrow();
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });

  it('throws when settings have localStorageOnly=true', async () => {
    mockLoadSettings.mockResolvedValueOnce({
      privacy: basePrivacy({ localStorageOnly: true, euDataResidency: false }),
    });
    await expect(assertCloudAiAllowed('gemini')).rejects.toThrow('local-only mode');
  });

  it('resolves without error when settings allow cloud', async () => {
    mockLoadSettings.mockResolvedValueOnce({
      privacy: basePrivacy({ localStorageOnly: false, euDataResidency: false }),
    });
    await expect(assertCloudAiAllowed('gemini')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// creativityTemperature
// ---------------------------------------------------------------------------

describe('CREATIVITY_TO_TEMPERATURE', () => {
  it('maps Focused to 0.2', () => {
    expect(CREATIVITY_TO_TEMPERATURE['Focused']).toBe(0.2);
  });

  it('maps Balanced to 0.7', () => {
    expect(CREATIVITY_TO_TEMPERATURE['Balanced']).toBe(0.7);
  });

  it('maps Imaginative to 1.0', () => {
    expect(CREATIVITY_TO_TEMPERATURE['Imaginative']).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// modelNormalization
// ---------------------------------------------------------------------------

describe('normalizeOpenAiCompatibleBaseUrl', () => {
  it('appends /v1 when missing', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:8080')).toBe(
      'http://localhost:8080/v1',
    );
  });

  it('does not double-append /v1', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:8080/v1')).toBe(
      'http://localhost:8080/v1',
    );
  });

  it('strips trailing slash before adding /v1', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:8080/')).toBe(
      'http://localhost:8080/v1',
    );
  });
});

describe('resolveOpenAiCompatibleRoot', () => {
  it('returns official OpenAI /v1 root when baseUrl is undefined', () => {
    expect(resolveOpenAiCompatibleRoot(undefined)).toBe('https://api.openai.com/v1');
  });

  it('returns official OpenAI /v1 root when baseUrl is empty string', () => {
    expect(resolveOpenAiCompatibleRoot('')).toBe('https://api.openai.com/v1');
  });

  it('normalizes a custom baseUrl', () => {
    expect(resolveOpenAiCompatibleRoot('http://localhost:1234')).toBe('http://localhost:1234/v1');
  });
});

describe('buildOpenRouterStyleHeaders', () => {
  it('returns undefined when no args provided', () => {
    expect(buildOpenRouterStyleHeaders()).toBeUndefined();
  });

  it('includes HTTP-Referer when siteUrl provided', () => {
    const headers = buildOpenRouterStyleHeaders('https://example.com');
    expect(headers?.['HTTP-Referer']).toBe('https://example.com');
  });

  it('includes X-Title when siteTitle provided', () => {
    const headers = buildOpenRouterStyleHeaders(undefined, 'My App');
    expect(headers?.['X-Title']).toBe('My App');
  });

  it('includes both headers when both provided', () => {
    const headers = buildOpenRouterStyleHeaders('https://example.com', 'My App');
    expect(headers?.['HTTP-Referer']).toBe('https://example.com');
    expect(headers?.['X-Title']).toBe('My App');
  });

  it('returns undefined when both args are empty strings', () => {
    expect(buildOpenRouterStyleHeaders('', '')).toBeUndefined();
  });
});

describe('normalizeOllamaModelId', () => {
  it('removes ollama/ prefix', () => {
    expect(normalizeOllamaModelId('ollama/llama3.2')).toBe('llama3.2');
  });

  it('leaves non-ollama model IDs unchanged', () => {
    expect(normalizeOllamaModelId('gemini-1.5-flash')).toBe('gemini-1.5-flash');
  });

  it('handles model without any prefix', () => {
    expect(normalizeOllamaModelId('gpt-4o-mini')).toBe('gpt-4o-mini');
  });
});
