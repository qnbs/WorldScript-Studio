import type { ThemeCustomization } from '../types';

/**
 * Theme customization runtime contract (#702 / #818).
 *
 * Precedence: base theme (dark/light/auto) → appearance preset (sepia) → user customization →
 * accessibility overrides. An empty string means "use the active theme's value".
 */

export const MAX_CUSTOM_CSS_LENGTH = 20_000;

export const EMPTY_THEME_CUSTOMIZATION: ThemeCustomization = {
  primaryColor: '',
  secondaryColor: '',
  accentColor: '',
  backgroundColor: '',
  textColor: '',
  customCss: '',
};

// QNBS-v3: the pre-#702 defaults were persisted for every user but never applied; treat them as unset so the fix does not repaint existing installs.
const LEGACY_DEFAULTS: Readonly<Record<ThemeColorKey, string>> = {
  primaryColor: '#3b82f6',
  secondaryColor: '#64748b',
  accentColor: '#f59e0b',
  backgroundColor: '#0f172a',
  textColor: '#f8fafc',
};

export type ThemeColorKey = Exclude<keyof ThemeCustomization, 'customCss'>;

export const THEME_COLOR_KEYS: readonly ThemeColorKey[] = [
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

function normalizeColor(key: ThemeColorKey, value: unknown): string {
  if (!isHexColor(value)) return '';
  const lower = value.toLowerCase();
  return lower === LEGACY_DEFAULTS[key] ? '' : lower;
}

/** Strips constructs that could load remote resources; CSP blocks them too, this is defense in depth. */
export function sanitizeCustomCss(css: unknown): string {
  if (typeof css !== 'string') return '';
  return css
    .slice(0, MAX_CUSTOM_CSS_LENGTH)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(?!['"]?\s*data:)[^)]*\)/gi, 'none');
}

export function normalizeThemeCustomization(raw: unknown): ThemeCustomization {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result: ThemeCustomization = { ...EMPTY_THEME_CUSTOMIZATION };
  for (const key of THEME_COLOR_KEYS) result[key] = normalizeColor(key, source[key]);
  result.customCss = sanitizeCustomCss(source['customCss']);
  return result;
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channelToLinear((n >> 16) & 0xff);
  const g = channelToLinear((n >> 8) & 0xff);
  const b = channelToLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #rrggbb colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ON_ACCENT_LIGHT = '#ffffff';
const ON_ACCENT_DARK = '#0f172a';

/** Picks the button text color that keeps the higher contrast on a custom primary color. */
export function pickOnAccentText(primary: string): string {
  return contrastRatio(primary, ON_ACCENT_LIGHT) >= contrastRatio(primary, ON_ACCENT_DARK)
    ? ON_ACCENT_LIGHT
    : ON_ACCENT_DARK;
}

export interface ThemeOverrideOptions {
  /** High contrast owns borders and focus rings; customization must not weaken them. */
  highContrast: boolean;
}

function addPrimary(vars: Record<string, string>, primary: string, highContrast: boolean): void {
  vars['--sc-accent'] = primary;
  vars['--sc-accent-hover'] = `color-mix(in srgb, ${primary} 85%, #000000)`;
  vars['--sc-accent-subtle'] = `color-mix(in srgb, ${primary} 12%, transparent)`;
  vars['--sc-accent-glow'] = `0 0 40px -10px color-mix(in srgb, ${primary} 35%, transparent)`;
  vars['--sc-text-on-accent'] = pickOnAccentText(primary);
  vars['--nav-border-active'] = primary;
  if (highContrast) return;
  vars['--sc-border-focus'] = primary;
  vars['--sc-ring-focus'] = `color-mix(in srgb, ${primary} 55%, transparent)`;
}

function addSurfaces(
  vars: Record<string, string>,
  tc: ThemeCustomization,
  highContrast: boolean,
): void {
  const text = tc.textColor || 'var(--sc-text-primary)';
  if (tc.backgroundColor) {
    const bg = tc.backgroundColor;
    vars['--sc-surface-base'] = bg;
    vars['--sc-surface-raised'] = `color-mix(in srgb, ${bg} 94%, ${text})`;
    vars['--sc-surface-overlay'] = `color-mix(in srgb, ${bg} 88%, ${text})`;
    vars['--sc-prose-bg'] = bg;
    vars['--sc-bg'] = bg;
    if (!highContrast) {
      vars['--sc-border-subtle'] = `color-mix(in srgb, ${text} 10%, transparent)`;
      vars['--sc-border-strong'] = `color-mix(in srgb, ${text} 18%, transparent)`;
    }
  }
  if (tc.textColor) {
    const bg = tc.backgroundColor || 'var(--sc-surface-base)';
    vars['--sc-text-primary'] = tc.textColor;
    vars['--sc-prose-fg'] = tc.textColor;
    vars['--sc-fg'] = tc.textColor;
    if (!tc.secondaryColor) {
      vars['--sc-text-secondary'] = `color-mix(in srgb, ${tc.textColor} 80%, ${bg})`;
      vars['--sc-text-muted'] = `color-mix(in srgb, ${tc.textColor} 62%, ${bg})`;
      vars['--sc-muted'] = vars['--sc-text-muted'];
    }
  }
}

/**
 * Maps a normalized customization onto semantic design tokens. Theme blocks redefine the alias
 * tokens (--sc-bg, --sc-prose-*) on <body>, so overrides set them explicitly instead of relying
 * on inheritance from :root.
 */
export function buildThemeOverrides(
  tc: ThemeCustomization,
  { highContrast }: ThemeOverrideOptions,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (tc.primaryColor) addPrimary(vars, tc.primaryColor, highContrast);
  if (tc.secondaryColor) {
    const bg = tc.backgroundColor || 'var(--sc-surface-base)';
    vars['--sc-text-secondary'] = tc.secondaryColor;
    vars['--sc-text-muted'] = `color-mix(in srgb, ${tc.secondaryColor} 78%, ${bg})`;
    vars['--sc-muted'] = vars['--sc-text-muted'];
  }
  if (tc.accentColor) {
    vars['--nav-border-active'] = tc.accentColor;
    vars['--sc-selection-bg'] = `color-mix(in srgb, ${tc.accentColor} 35%, transparent)`;
  }
  addSurfaces(vars, tc, highContrast);
  return vars;
}

export function hasThemeCustomization(tc: ThemeCustomization): boolean {
  return THEME_COLOR_KEYS.some((key) => tc[key] !== '') || tc.customCss.trim() !== '';
}
