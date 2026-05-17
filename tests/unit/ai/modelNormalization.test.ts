import { describe, expect, it } from 'vitest';
import {
  buildOpenRouterStyleHeaders,
  normalizeOllamaModelId,
  normalizeOpenAiCompatibleBaseUrl,
  resolveOpenAiCompatibleRoot,
} from '../../../services/ai/modelNormalization';
import type { AiModel } from '../../../types';

describe('normalizeOpenAiCompatibleBaseUrl', () => {
  it('appends /v1 when not present', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:1234')).toBe(
      'http://localhost:1234/v1',
    );
  });

  it('does not double-append /v1', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:1234/v1')).toBe(
      'http://localhost:1234/v1',
    );
  });

  it('strips trailing slash before appending /v1', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://localhost:1234/')).toBe(
      'http://localhost:1234/v1',
    );
  });

  it('handles a URL that already has /v1/ (trailing slash stripped)', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('http://host/v1/')).toBe('http://host/v1');
  });
});

describe('resolveOpenAiCompatibleRoot', () => {
  it('returns official OpenAI root when baseUrl is undefined', () => {
    expect(resolveOpenAiCompatibleRoot(undefined)).toBe('https://api.openai.com/v1');
  });

  it('returns official OpenAI root when baseUrl is empty string', () => {
    expect(resolveOpenAiCompatibleRoot('')).toBe('https://api.openai.com/v1');
  });

  it('returns official OpenAI root when baseUrl is only whitespace', () => {
    expect(resolveOpenAiCompatibleRoot('   ')).toBe('https://api.openai.com/v1');
  });

  it('normalises a custom base URL', () => {
    expect(resolveOpenAiCompatibleRoot('http://localhost:1234')).toBe('http://localhost:1234/v1');
  });

  it('does not double-append /v1 for custom URLs', () => {
    expect(resolveOpenAiCompatibleRoot('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1',
    );
  });
});

describe('buildOpenRouterStyleHeaders', () => {
  it('returns undefined when both siteUrl and siteTitle are absent', () => {
    expect(buildOpenRouterStyleHeaders()).toBeUndefined();
  });

  it('returns undefined when both args are empty strings', () => {
    expect(buildOpenRouterStyleHeaders('', '')).toBeUndefined();
  });

  it('includes HTTP-Referer when siteUrl is provided', () => {
    const headers = buildOpenRouterStyleHeaders('https://myapp.com');
    expect(headers?.['HTTP-Referer']).toBe('https://myapp.com');
    expect(headers?.['X-Title']).toBeUndefined();
  });

  it('includes X-Title when siteTitle is provided', () => {
    const headers = buildOpenRouterStyleHeaders(undefined, 'My App');
    expect(headers?.['X-Title']).toBe('My App');
    expect(headers?.['HTTP-Referer']).toBeUndefined();
  });

  it('includes both headers when both args are provided', () => {
    const headers = buildOpenRouterStyleHeaders('https://myapp.com', 'My App');
    expect(headers).toEqual({ 'HTTP-Referer': 'https://myapp.com', 'X-Title': 'My App' });
  });

  it('trims whitespace from values', () => {
    const headers = buildOpenRouterStyleHeaders('  https://myapp.com  ', '  My App  ');
    expect(headers?.['HTTP-Referer']).toBe('https://myapp.com');
    expect(headers?.['X-Title']).toBe('My App');
  });
});

describe('normalizeOllamaModelId', () => {
  it('strips the ollama/ prefix', () => {
    expect(normalizeOllamaModelId('ollama/llama3')).toBe('llama3');
  });

  it('leaves strings without the prefix unchanged', () => {
    expect(normalizeOllamaModelId('llama3' as AiModel)).toBe('llama3');
  });

  it('leaves gemini model IDs unchanged', () => {
    expect(normalizeOllamaModelId('gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('handles empty string', () => {
    expect(normalizeOllamaModelId('' as AiModel)).toBe('');
  });
});
