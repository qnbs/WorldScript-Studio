import { describe, expect, it } from 'vitest';
// QNBS-v3: this test locks the UI catalogs, defaults, and proxy allowlist together.
import { ALLOWED_MODELS } from '../../../api/_shared/claudeProxyCore';
import {
  ANTHROPIC_MODEL_IDS,
  ANTHROPIC_MODEL_OPTIONS,
  CLOUD_MODEL_CATALOG,
  classifyPersistedCloudModel,
  DEFAULT_ANTHROPIC_MODEL_ID,
  DEFAULT_GEMINI_MODEL_ID,
  DEFAULT_GROK_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  GEMINI_ADMITTED_MODEL_IDS,
  GEMINI_LEGACY_MODEL_IDS,
  GEMINI_MODEL_IDS,
  GEMINI_MODEL_OPTIONS,
  GEMINI_PREVIEW_MODEL_IDS,
  GROK_ADMITTED_MODEL_IDS,
  GROK_MODEL_IDS,
  GROK_MODEL_OPTIONS,
  isModelInCatalog,
  OPENAI_MODEL_IDS,
  OPENAI_MODEL_OPTIONS,
} from '../../../services/ai/cloudModelCatalog';

describe('cloud model catalog', () => {
  it('keeps the Anthropic settings values identical to the proxy allowlist', () => {
    expect(ANTHROPIC_MODEL_OPTIONS.map(({ value }) => value)).toEqual([...ALLOWED_MODELS]);
    expect(ANTHROPIC_MODEL_IDS).toEqual(ALLOWED_MODELS);
  });

  it('keeps current OpenAI and Grok option values identical to their catalogs', () => {
    expect(OPENAI_MODEL_OPTIONS.map(({ value }) => value)).toEqual([...OPENAI_MODEL_IDS]);
    expect(GROK_MODEL_OPTIONS.map(({ value }) => value)).toEqual([...GROK_MODEL_IDS]);
    expect(GEMINI_MODEL_OPTIONS.map(({ value }) => value)).toEqual([...GEMINI_MODEL_IDS]);
  });

  it('keeps named fallbacks inside their current provider catalogs', () => {
    expect(ANTHROPIC_MODEL_IDS).toContain(DEFAULT_ANTHROPIC_MODEL_ID);
    expect(OPENAI_MODEL_IDS).toContain(DEFAULT_OPENAI_MODEL_ID);
    expect(GROK_MODEL_IDS).toContain(DEFAULT_GROK_MODEL_ID);
  });

  it('rejects legacy IDs even when they share a provider prefix', () => {
    expect(isModelInCatalog(GROK_MODEL_IDS, 'grok-3-mini')).toBe(false);
    expect(isModelInCatalog(OPENAI_MODEL_IDS, 'gpt-4o')).toBe(false);
    expect(isModelInCatalog(ANTHROPIC_MODEL_IDS, 'claude-haiku-4-5')).toBe(false);
  });

  it('keeps one metadata entry per curated or compatibility ID', () => {
    const ids = CLOUD_MODEL_CATALOG.map(({ provider, modelId }) => `${provider}:${modelId}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CLOUD_MODEL_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'gemini',
          modelId: DEFAULT_GEMINI_MODEL_ID,
          lifecycle: 'recommended-default',
          supportsStreaming: true,
        }),
        expect.objectContaining({
          provider: 'openai',
          modelId: DEFAULT_OPENAI_MODEL_ID,
          lifecycle: 'recommended-default',
        }),
      ]),
    );
  });

  it('keeps preview IDs out of ordinary current admission', () => {
    expect(GEMINI_PREVIEW_MODEL_IDS).not.toContain(DEFAULT_GEMINI_MODEL_ID);
    expect(isModelInCatalog(GEMINI_PREVIEW_MODEL_IDS, 'gemini-3.1-pro-preview')).toBe(true);
    expect(
      CLOUD_MODEL_CATALOG.find(({ modelId }) => modelId === 'gemini-3.1-pro-preview')?.lifecycle,
    ).toBe('preview-opt-in');
  });

  it('keeps the current Gemini public-source subset distinct from legacy and preview IDs', () => {
    expect(GEMINI_MODEL_IDS).toEqual([
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ]);
    expect(GEMINI_ADMITTED_MODEL_IDS).toContain('gemini-3.1-pro-preview');
    expect(GEMINI_MODEL_IDS).not.toContain('gemini-3.1-flash');
    expect(GEMINI_LEGACY_MODEL_IDS).toContain('gemini-3.1-flash');
    expect(GROK_ADMITTED_MODEL_IDS).toContain('grok-4.20');
  });

  it('explicitly migrates legacy values and preserves custom endpoints', () => {
    expect(classifyPersistedCloudModel('openai', 'gpt-4o').replacementModel).toBe(
      DEFAULT_OPENAI_MODEL_ID,
    );
    expect(
      classifyPersistedCloudModel('openai', 'tenant-model', 'https://example.test/v1'),
    ).toEqual({ model: 'tenant-model', status: 'custom-compatible' });
    expect(classifyPersistedCloudModel('openrouter', 'vendor/model:free')).toEqual({
      model: 'vendor/model:free',
      status: 'custom-compatible',
    });
    expect(classifyPersistedCloudModel('gemini', 'gemini-3.1-flash')).toEqual({
      model: 'gemini-3.1-flash',
      status: 'legacy-compat',
      replacementModel: DEFAULT_GEMINI_MODEL_ID,
    });
    expect(classifyPersistedCloudModel('openai', 'gemini-3.1-flash').status).toBe(
      'unknown-stored-value',
    );
    expect(classifyPersistedCloudModel('grok', 'grok-4.20').status).toBe('preview-opt-in');
    expect(classifyPersistedCloudModel('openrouter', '   ').status).toBe('unknown-stored-value');
    expect(classifyPersistedCloudModel('gemini', 42)).toEqual({
      model: '',
      status: 'unknown-stored-value',
    });
  });
});
