import { EMPTY_THEME_CUSTOMIZATION } from './themeCustomization';

/**
 * One-time migration for #702. Before Theme Customization was applied at runtime, these defaults
 * were persisted for every user without ever taking effect. Clearing them once keeps existing
 * installs looking the same; afterwards the user may pick any color, these included.
 */
const LEGACY_DEFAULTS: Readonly<Record<string, string>> = {
  primaryColor: '#3b82f6',
  secondaryColor: '#64748b',
  accentColor: '#f59e0b',
  backgroundColor: '#0f172a',
  textColor: '#f8fafc',
};

export function migrateLegacyThemeCustomization(raw: unknown): Record<string, unknown> {
  const source = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  if (source['legacyDefaultsCleared'] === true) return source;
  for (const [key, legacy] of Object.entries(LEGACY_DEFAULTS)) {
    const value = source[key];
    if (typeof value === 'string' && value.toLowerCase() === legacy) source[key] = '';
  }
  source['legacyDefaultsCleared'] = true;
  return source;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Hydration is preserve-first: unknown fields, invalid colors and the full custom CSS source stay as
 * stored, so the next settings save writes them back unchanged. Only the runtime applies the
 * normalized, sanitized view (`normalizeThemeCustomization`). An absent record gets the defaults; a
 * malformed non-object value is kept untouched and never applied or migrated.
 */
export function hydrateThemeCustomization(raw: unknown): unknown {
  if (raw === undefined) return { ...EMPTY_THEME_CUSTOMIZATION, legacyDefaultsCleared: true };
  if (!isPlainObject(raw)) return raw;
  return { ...EMPTY_THEME_CUSTOMIZATION, ...migrateLegacyThemeCustomization(raw) };
}
