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
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => {
      // QNBS-v3 (#702): CSS Syntax §4.3.7 — zero, surrogate and out-of-range escapes become U+FFFD; String.fromCodePoint would throw above U+10FFFF.
      const codePoint = Number.parseInt(hex, 16);
      const inRange = codePoint > 0 && codePoint <= 0x10ffff;
      const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
      return String.fromCodePoint(inRange && !surrogate ? codePoint : 0xfffd);
    })
    .replace(/\\(.)/g, '$1');
}

const REMOTE_IMPORT = /@import/i;
// QNBS-v3 (#702): (?!\s) makes \s* consume all whitespace, so the data: lookahead cannot be skipped by backtracking (`url( "data:…")`).
const REMOTE_URL = /url\(\s*(?!\s)(?!['"]?\s*data:)/i;
const REMOTE_URL_CALL = /url\(\s*(?!\s)(?!['"]?\s*data:)[^)]*\)/gi;

/** @import, remote url(), or an image-set() string (it fetches without url()) that is not a data: URL. */
function hasRemoteReference(css: string): boolean {
  if (REMOTE_IMPORT.test(css) || REMOTE_URL.test(css)) return true;
  for (const [, args = ''] of css.matchAll(/image-set\(((?:[^()]|\([^()]*\))*)\)/gi)) {
    // type("image/avif") names a MIME type, not a resource.
    const sources = args.replace(/type\(\s*(['"]).*?\1\s*\)/gi, '');
    for (const [, , value = ''] of sources.matchAll(/(['"])(.*?)\1/g)) {
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
    .replace(REMOTE_URL_CALL, 'none');
  return hasRemoteReference(decodeCssEscapes(stripped)) ? '' : stripped;
}

export function normalizeThemeCustomization(raw: unknown): ThemeCustomization {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result: ThemeCustomization = { ...EMPTY_THEME_CUSTOMIZATION };
  for (const key of THEME_COLOR_KEYS) result[key] = normalizeColor(source[key]);
  result.customCss = sanitizeCustomCss(source['customCss']);
  return result;
}

export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r = 0, g = 0, b = 0] = [16, 8, 0].map((shift) => {
    const c = ((n >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function luminanceContrast(la: number, lb: number): number {
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ColorPair {
  foreground: string;
  background: string;
}

/** WCAG 2.x contrast ratio between two #rrggbb colors (1–21). */
export function contrastRatio({ foreground, background }: ColorPair): number {
  return luminanceContrast(relativeLuminance(foreground), relativeLuminance(background));
}

export const WCAG_AA_TEXT_CONTRAST = 4.5;

/**
 * Relative luminance of the --sc-on-accent-light/-dark tokens in index.css (#ffffff, #0f172a;
 * --sc-on-accent-black is #000000, luminance 0).
 * QNBS-v3 (#702): kept as luminances so the token values stay in index.css; a unit test fails if they drift.
 */
export const ON_ACCENT_LIGHT_LUMINANCE = 1;
export const ON_ACCENT_DARK_LUMINANCE = 0.008815176790098227;

interface ReadableText {
  token: string;
  isDark: boolean;
}

/**
 * Text token for a custom surface color that always reaches WCAG AA: the better of white and
 * black is at least 4.58:1 for any color, and the softer dark token is used only when it also
 * reaches 4.5:1.
 */
function readableTextOn(color: string): ReadableText {
  const background = relativeLuminance(color);
  const isDark =
    luminanceContrast(background, 0) > luminanceContrast(background, ON_ACCENT_LIGHT_LUMINANCE);
  if (!isDark) return { token: 'var(--sc-on-accent-light)', isDark };
  const softReadable =
    luminanceContrast(background, ON_ACCENT_DARK_LUMINANCE) >= WCAG_AA_TEXT_CONTRAST;
  return { token: softReadable ? 'var(--sc-on-accent-dark)' : 'var(--sc-on-accent-black)', isDark };
}

export interface ThemeOverrideOptions {
  /** High contrast (in-app toggle or OS preference) pauses color customization; accessibility wins. */
  highContrast: boolean;
}

/**
 * Button text always reaches WCAG AA (readableTextOn). Hover moves the background away from that
 * text (lighter under dark text, darker under light text), so the label keeps at least its
 * resting contrast.
 */
function addPrimary(
  vars: Record<string, string>,
  { primaryColor: primary }: ThemeCustomization,
): void {
  const label = readableTextOn(primary);
  const hoverMix = label.isDark ? 'var(--sc-on-accent-light)' : 'var(--sc-shade)';
  vars['--sc-accent'] = primary;
  vars['--sc-accent-hover'] = `color-mix(in srgb, ${primary} 85%, ${hoverMix})`;
  vars['--sc-accent-subtle'] = `color-mix(in srgb, ${primary} 12%, transparent)`;
  vars['--sc-accent-glow'] = `0 0 40px -10px color-mix(in srgb, ${primary} 35%, transparent)`;
  vars['--sc-text-on-accent'] = label.token;
  vars['--nav-border-active'] = primary;
  vars['--sc-border-focus'] = primary;
  vars['--sc-ring-focus'] = `color-mix(in srgb, ${primary} 55%, transparent)`;
}

function addSecondary(vars: Record<string, string>, tc: ThemeCustomization): void {
  const background = tc.backgroundColor || 'var(--sc-surface-base)';
  vars['--sc-text-secondary'] = tc.secondaryColor;
  vars['--sc-text-muted'] = `color-mix(in srgb, ${tc.secondaryColor} 78%, ${background})`;
  vars['--sc-muted'] = vars['--sc-text-muted'];
}

function addAccent(vars: Record<string, string>, { accentColor }: ThemeCustomization): void {
  vars['--nav-border-active'] = accentColor;
  vars['--sc-selection-bg'] = `color-mix(in srgb, ${accentColor} 35%, transparent)`;
}

function addBackground(vars: Record<string, string>, tc: ThemeCustomization): void {
  const background = tc.backgroundColor;
  const text = tc.textColor || 'var(--sc-text-primary)';
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

/** A custom background without a text color gets contrast-safe text; the theme's text may not suit it. */
function withReadableText(tc: ThemeCustomization): ThemeCustomization {
  if (tc.textColor || !tc.backgroundColor) return tc;
  return { ...tc, textColor: readableTextOn(tc.backgroundColor).token };
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
  const effective = withReadableText(tc);
  if (effective.primaryColor) addPrimary(vars, effective);
  if (effective.secondaryColor) addSecondary(vars, effective);
  if (effective.accentColor) addAccent(vars, effective);
  if (effective.backgroundColor) addBackground(vars, effective);
  if (effective.textColor) addText(vars, effective);
  return vars;
}

export function hasThemeCustomization(tc: ThemeCustomization): boolean {
  return THEME_COLOR_KEYS.some((key) => tc[key] !== '') || tc.customCss.trim() !== '';
}
