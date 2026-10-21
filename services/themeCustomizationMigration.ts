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
