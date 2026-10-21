import { describe, expect, it } from 'vitest';
import { migrateLegacyThemeCustomization } from '../../../services/themeCustomizationMigration';

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
