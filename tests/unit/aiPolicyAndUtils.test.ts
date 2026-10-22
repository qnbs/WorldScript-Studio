/**
 * Tests for services/ai/creativityTemperature.ts and modelNormalization.ts (aiPolicy: tests/unit/ai/aiPolicy.test.ts).
 * QNBS-v3: Pure logic — no network.
 */

import { describe, expect, it } from 'vitest';

import { CREATIVITY_TO_TEMPERATURE } from '../../services/ai/creativityTemperature';
import {
  buildOpenRouterStyleHeaders,
  normalizeOllamaModelId,
  normalizeOpenAiCompatibleBaseUrl,
  resolveOpenAiCompatibleRoot,
} from '../../services/ai/modelNormalization';

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
