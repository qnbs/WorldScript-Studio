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

export type ThemeColorKey = Exclude<
  keyof ThemeCustomization,
  'customCss' | 'legacyDefaultsCleared'
>;

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

function normalizeColor(value: unknown): string {
  return isHexColor(value) ? value.toLowerCase() : '';
}

/** Decodes CSS escapes (`\75 rl`, `\@`) the way the CSS tokenizer would, for detection only. */
function decodeCssEscapes(css: string): string {
  return css
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd),
    )
    .replace(/\\(.)/g, '$1');
}

const REMOTE_IMPORT = /@import/i;
const REMOTE_URL = /url\(\s*(?!['"]?\s*data:)/i;

/** image-set() can fetch from plain strings without url(); every string in it must be a data: URL. */
function hasRemoteImageSet(css: string): boolean {
  for (const [, args = ''] of css.matchAll(/image-set\(([^)]*)\)/gi)) {
    for (const [, , value = ''] of args.matchAll(/(['"])(.*?)\1/g)) {
      if (!value.trim().toLowerCase().startsWith('data:')) return true;
    }
  }
  return false;
}

/**
 * Strips constructs that could load remote resources; CSP blocks them too, this is defense in
 * depth. Escaped spellings that survive the plain patterns fail closed: the whole stylesheet is dropped.
 */
export function sanitizeCustomCss(css: unknown): string {
  if (typeof css !== 'string') return '';
  const stripped = css
    .slice(0, MAX_CUSTOM_CSS_LENGTH)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(?!['"]?\s*data:)[^)]*\)/gi, 'none');
  const decoded = decodeCssEscapes(stripped);
  if (REMOTE_IMPORT.test(decoded) || REMOTE_URL.test(decoded) || hasRemoteImageSet(decoded)) {
    return '';
  }
  return stripped;
}

export function normalizeThemeCustomization(raw: unknown): ThemeCustomization {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result: ThemeCustomization = { ...EMPTY_THEME_CUSTOMIZATION };
  for (const key of THEME_COLOR_KEYS) result[key] = normalizeColor(source[key]);
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

// QNBS-v3: WCAG crossover where dark text starts to out-contrast white; both text colors are design tokens in index.css.
const DARK_TEXT_LUMINANCE_THRESHOLD = 0.179;

/** Picks the button text token that stays readable on a custom primary color. */
export function pickOnAccentText(primary: string): string {
  return relativeLuminance(primary) > DARK_TEXT_LUMINANCE_THRESHOLD
    ? 'var(--sc-on-accent-dark)'
    : 'var(--sc-on-accent-light)';
}

export interface ThemeOverrideOptions {
  /** High contrast (in-app toggle or OS preference) pauses color customization; accessibility wins. */
  highContrast: boolean;
}

function addPrimary(vars: Record<string, string>, primary: string): void {
  vars['--sc-accent'] = primary;
  vars['--sc-accent-hover'] = `color-mix(in srgb, ${primary} 85%, var(--sc-shade))`;
  vars['--sc-accent-subtle'] = `color-mix(in srgb, ${primary} 12%, transparent)`;
  vars['--sc-accent-glow'] = `0 0 40px -10px color-mix(in srgb, ${primary} 35%, transparent)`;
  vars['--sc-text-on-accent'] = pickOnAccentText(primary);
  vars['--nav-border-active'] = primary;
  vars['--sc-border-focus'] = primary;
  vars['--sc-ring-focus'] = `color-mix(in srgb, ${primary} 55%, transparent)`;
}

function addBackground(vars: Record<string, string>, background: string, text: string): void {
  vars['--sc-surface-base'] = background;
  vars['--sc-surface-raised'] = `color-mix(in srgb, ${background} 94%, ${text})`;
  vars['--sc-surface-overlay'] = `color-mix(in srgb, ${background} 88%, ${text})`;
  vars['--sc-prose-bg'] = background;
  vars['--sc-bg'] = background;
  vars['--sc-border-subtle'] = `color-mix(in srgb, ${text} 10%, transparent)`;
  vars['--sc-border-strong'] = `color-mix(in srgb, ${text} 18%, transparent)`;
}

function addText(vars: Record<string, string>, tc: ThemeCustomization): void {
  const background = tc.backgroundColor || 'var(--sc-surface-base)';
  vars['--sc-text-primary'] = tc.textColor;
  vars['--sc-prose-fg'] = tc.textColor;
  vars['--sc-fg'] = tc.textColor;
  if (tc.secondaryColor) return;
  vars['--sc-text-secondary'] = `color-mix(in srgb, ${tc.textColor} 80%, ${background})`;
  vars['--sc-text-muted'] = `color-mix(in srgb, ${tc.textColor} 62%, ${background})`;
  vars['--sc-muted'] = vars['--sc-text-muted'];
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
  // QNBS-v3 (#702/#818): high-contrast tokens derive from --sc-accent and the surfaces, so any user color could undo them; colors pause, custom CSS stays.
  if (highContrast) return vars;
  if (tc.primaryColor) addPrimary(vars, tc.primaryColor);
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
  if (tc.backgroundColor) {
    addBackground(vars, tc.backgroundColor, tc.textColor || 'var(--sc-text-primary)');
  }
  if (tc.textColor) addText(vars, tc);
  return vars;
}

export function hasThemeCustomization(tc: ThemeCustomization): boolean {
  return THEME_COLOR_KEYS.some((key) => tc[key] !== '') || tc.customCss.trim() !== '';
}
