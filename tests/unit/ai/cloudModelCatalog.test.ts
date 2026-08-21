import { describe, expect, it } from 'vitest';
// QNBS-v3: this test locks the UI catalogs, defaults, and proxy allowlist together.
import { ALLOWED_MODELS } from '../../../api/_shared/claudeProxyCore';
import {
  ANTHROPIC_MODEL_IDS,
  ANTHROPIC_MODEL_OPTIONS,
  DEFAULT_ANTHROPIC_MODEL_ID,
  DEFAULT_GROK_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  GROK_MODEL_IDS,
  GROK_MODEL_OPTIONS,
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
  });

  it('keeps named fallbacks inside their current provider catalogs', () => {
    expect(ANTHROPIC_MODEL_IDS).toContain(DEFAULT_ANTHROPIC_MODEL_ID);
    expect(OPENAI_MODEL_IDS).toContain(DEFAULT_OPENAI_MODEL_ID);
    expect(GROK_MODEL_IDS).toContain(DEFAULT_GROK_MODEL_ID);
  });
});
