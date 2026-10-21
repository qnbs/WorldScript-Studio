import { describe, expect, it } from 'vitest';
import { EMPTY_THEME_CUSTOMIZATION } from '../../../services/themeCustomization';
import {
  hydrateThemeCustomization,
  migrateLegacyThemeCustomization,
} from '../../../services/themeCustomizationMigration';

describe('migrateLegacyThemeCustomization (#702)', () => {
  it('clears the never-applied legacy defaults once and marks the record', () => {
    const migrated = migrateLegacyThemeCustomization({
      primaryColor: '#3B82F6',
      secondaryColor: '#123456',
      backgroundColor: '#0f172a',
      customCss: '.a{}',
    });
    expect(migrated).toMatchObject({
      primaryColor: '',
      secondaryColor: '#123456',
      backgroundColor: '',
      customCss: '.a{}',
      legacyDefaultsCleared: true,
    });
  });

  it('leaves an already migrated record untouched, so a re-picked former default sticks', () => {
    const record = { primaryColor: '#3b82f6', legacyDefaultsCleared: true };
    expect(migrateLegacyThemeCustomization(record)).toEqual(record);
  });

  it('handles missing input', () => {
    expect(migrateLegacyThemeCustomization(undefined)).toEqual({ legacyDefaultsCleared: true });
  });
});

describe('hydrateThemeCustomization (#702)', () => {
  it('gives an absent record the migrated defaults', () => {
    expect(hydrateThemeCustomization(undefined)).toEqual({
      ...EMPTY_THEME_CUSTOMIZATION,
      legacyDefaultsCleared: true,
    });
  });

  it('keeps unknown fields, invalid colors and the raw CSS source', () => {
    const raw = { accentColor: 'red', customCss: '@import "a.css";', extra: 1 };
    expect(hydrateThemeCustomization(raw)).toEqual({
      ...EMPTY_THEME_CUSTOMIZATION,
      ...raw,
      legacyDefaultsCleared: true,
    });
  });

  it('returns a malformed non-object value unchanged and unmarked', () => {
    const malformed = ['#ffffff'];
    expect(hydrateThemeCustomization(malformed)).toBe(malformed);
    expect(hydrateThemeCustomization(null)).toBeNull();
  });
});
