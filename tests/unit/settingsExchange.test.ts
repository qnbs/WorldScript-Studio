import { describe, expect, it } from 'vitest';
import {
  buildSettingsExportEnvelope,
  parseSettingsImportEnvelope,
  SETTINGS_EXPORT_VERSION,
  settingsExportEnvelopeSchema,
} from '../../services/settingsExchange';
import type { Settings } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('SETTINGS_EXPORT_VERSION', () => {
  it('is 1', () => {
    expect(SETTINGS_EXPORT_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildSettingsExportEnvelope
// ---------------------------------------------------------------------------
describe('buildSettingsExportEnvelope', () => {
  const minSettings = {
    theme: 'dark',
    language: 'en',
  } as unknown as Settings;

  it('sets worldscriptSettingsExportVersion to 1', () => {
    const env = buildSettingsExportEnvelope(minSettings);
    expect(env.worldscriptSettingsExportVersion).toBe(1);
  });

  it('copies all settings keys into the settings field', () => {
    const env = buildSettingsExportEnvelope(minSettings);
    expect(env.settings['theme']).toBe('dark');
    expect(env.settings['language']).toBe('en');
  });

  it('does not mutate the original settings object', () => {
    const original = { theme: 'light', language: 'de' } as unknown as Settings;
    buildSettingsExportEnvelope(original);
    expect(original.theme).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// parseSettingsImportEnvelope
// ---------------------------------------------------------------------------
describe('parseSettingsImportEnvelope', () => {
  it('returns parsed settings for a valid envelope', () => {
    const input = {
      worldscriptSettingsExportVersion: 1,
      settings: { theme: 'dark', language: 'en' },
    };
    const result = parseSettingsImportEnvelope(input);
    expect(result).not.toBeNull();
    expect(result?.['theme']).toBe('dark');
  });

  it('returns null for missing version field', () => {
    expect(parseSettingsImportEnvelope({ settings: {} })).toBeNull();
  });

  it('returns null for wrong version value', () => {
    expect(
      parseSettingsImportEnvelope({ worldscriptSettingsExportVersion: 2, settings: {} }),
    ).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseSettingsImportEnvelope(null)).toBeNull();
    expect(parseSettingsImportEnvelope('string')).toBeNull();
    expect(parseSettingsImportEnvelope(42)).toBeNull();
  });

  it('returns null when settings field is missing', () => {
    expect(parseSettingsImportEnvelope({ worldscriptSettingsExportVersion: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// settingsExportEnvelopeSchema
// ---------------------------------------------------------------------------
describe('settingsExportEnvelopeSchema', () => {
  it('validates a correct envelope', () => {
    const result = settingsExportEnvelopeSchema.safeParse({
      worldscriptSettingsExportVersion: 1,
      settings: { theme: 'light' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects version other than 1', () => {
    const result = settingsExportEnvelopeSchema.safeParse({
      worldscriptSettingsExportVersion: 99,
      settings: {},
    });
    expect(result.success).toBe(false);
  });
});
