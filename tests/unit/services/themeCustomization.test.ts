import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildThemeOverrides,
  contrastRatio,
  EMPTY_THEME_CUSTOMIZATION,
  hasThemeCustomization,
  MAX_CUSTOM_CSS_LENGTH,
  normalizeThemeCustomization,
  ON_ACCENT_DARK_LUMINANCE,
  ON_ACCENT_LIGHT_LUMINANCE,
  pickOnAccentText,
  relativeLuminance,
  sanitizeCustomCss,
} from '../../../services/themeCustomization';

const off = { highContrast: false };

describe('normalizeThemeCustomization', () => {
  it('keeps every explicit color at runtime, including the former defaults', () => {
    const tc = normalizeThemeCustomization({ primaryColor: '#3B82F6', backgroundColor: '#0f172a' });
    expect(tc.primaryColor).toBe('#3b82f6');
    expect(tc.backgroundColor).toBe('#0f172a');
  });

  it('keeps valid colors lowercased and drops invalid ones', () => {
    const tc = normalizeThemeCustomization({
      primaryColor: '#AA00FF',
      secondaryColor: 'red',
      accentColor: '#fff',
      backgroundColor: 42,
    });
    expect(tc.primaryColor).toBe('#aa00ff');
    expect(tc.secondaryColor).toBe('');
    expect(tc.accentColor).toBe('');
    expect(tc.backgroundColor).toBe('');
  });

  it('fails safe for missing or malformed input', () => {
    expect(normalizeThemeCustomization(undefined)).toEqual(EMPTY_THEME_CUSTOMIZATION);
    expect(normalizeThemeCustomization('nope')).toEqual(EMPTY_THEME_CUSTOMIZATION);
  });
});

describe('sanitizeCustomCss', () => {
  it('removes @import rules and remote url() references but keeps data: URLs', () => {
    const css = [
      '@import url("https://evil.example/x.css");',
      '.a { background: url(https://tracker.example/p.png); }',
      ".b { background: url('//cdn.example/i.png'); }",
      '.c { background: url("data:image/png;base64,AAAA"); }',
    ].join('\n');
    const out = sanitizeCustomCss(css);
    expect(out).not.toContain('@import');
    expect(out).not.toContain('tracker.example');
    expect(out).not.toContain('cdn.example');
    expect(out).toContain('url("data:image/png;base64,AAAA")');
  });

  it('drops the whole stylesheet when an escaped @import or url() would survive', () => {
    expect(sanitizeCustomCss('.a { background: \\75 rl(https://x.example/p.png); }')).toBe('');
    expect(sanitizeCustomCss('@\\69 mport "https://x.example/a.css";')).toBe('');
    expect(sanitizeCustomCss('.a { content: "\\201C"; color: red; }')).toBe(
      '.a { content: "\\201C"; color: red; }',
    );
  });

  it('treats out-of-range and surrogate escapes as replacement characters instead of throwing', () => {
    for (const css of [
      '.a { content: "\\110000"; }',
      '/* \\ffffff */ .a {}',
      '.a { content: "\\d800"; }',
    ]) {
      expect(sanitizeCustomCss(css)).toBe(css);
    }
  });

  it('drops image-set() with remote strings but keeps data: sources', () => {
    expect(sanitizeCustomCss('.a { background: image-set("https://x.example/a.png" 1x); }')).toBe(
      '',
    );
    const local = '.a { background: image-set("data:image/png;base64,AAAA" 1x); }';
    expect(sanitizeCustomCss(local)).toBe(local);
  });

  it('caps the stylesheet length and ignores non-strings', () => {
    expect(sanitizeCustomCss('a'.repeat(MAX_CUSTOM_CSS_LENGTH + 50))).toHaveLength(
      MAX_CUSTOM_CSS_LENGTH,
    );
    expect(sanitizeCustomCss(null)).toBe('');
  });
});

describe('contrast helpers', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('picks the more readable text color for a custom primary', () => {
    expect(pickOnAccentText('#fde047')).toBe('var(--sc-on-accent-dark)');
    expect(pickOnAccentText('#1e3a8a')).toBe('var(--sc-on-accent-light)');
  });

  it('compares against the real token colors, not black and white', () => {
    // #767676: white reaches 4.54:1, the dark token #0f172a only 3.93:1.
    expect(pickOnAccentText('#767676')).toBe('var(--sc-on-accent-light)');
    expect(pickOnAccentText('#888888')).toBe('var(--sc-on-accent-dark)');
  });

  it('keeps the on-accent luminances in sync with the index.css tokens', () => {
    const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');
    const expected = [
      ['light', ON_ACCENT_LIGHT_LUMINANCE],
      ['dark', ON_ACCENT_DARK_LUMINANCE],
    ] as const;
    for (const [variant, luminance] of expected) {
      const hex = new RegExp(`--sc-on-accent-${variant}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1];
      expect(hex).toBeDefined();
      expect(relativeLuminance(hex ?? '')).toBeCloseTo(luminance, 12);
    }
  });
});

describe('buildThemeOverrides', () => {
  it('returns no overrides when nothing is customized', () => {
    expect(buildThemeOverrides(EMPTY_THEME_CUSTOMIZATION, off)).toEqual({});
  });

  it('maps the primary color onto the accent family and focus tokens', () => {
    const vars = buildThemeOverrides(
      { ...EMPTY_THEME_CUSTOMIZATION, primaryColor: '#1e3a8a' },
      off,
    );
    expect(vars['--sc-accent']).toBe('#1e3a8a');
    expect(vars['--sc-text-on-accent']).toBe('var(--sc-on-accent-light)');
    expect(vars['--sc-border-focus']).toBe('#1e3a8a');
    expect(vars['--sc-ring-focus']).toContain('#1e3a8a');
  });

  it('pauses every color override while high contrast is active', () => {
    expect(
      buildThemeOverrides(
        { ...EMPTY_THEME_CUSTOMIZATION, primaryColor: '#ffffff', backgroundColor: '#ffffff' },
        { highContrast: true },
      ),
    ).toEqual({});
  });

  it('sets the body-level alias tokens together with a custom background and text', () => {
    const vars = buildThemeOverrides(
      { ...EMPTY_THEME_CUSTOMIZATION, backgroundColor: '#fefae0', textColor: '#283618' },
      off,
    );
    expect(vars['--sc-surface-base']).toBe('#fefae0');
    expect(vars['--sc-bg']).toBe('#fefae0');
    expect(vars['--sc-prose-bg']).toBe('#fefae0');
    expect(vars['--sc-text-primary']).toBe('#283618');
    expect(vars['--sc-fg']).toBe('#283618');
    expect(vars['--sc-text-secondary']).toContain('#283618');
  });

  it('lets an explicit secondary color win over the text-derived one', () => {
    const vars = buildThemeOverrides(
      { ...EMPTY_THEME_CUSTOMIZATION, textColor: '#283618', secondaryColor: '#606c38' },
      off,
    );
    expect(vars['--sc-text-secondary']).toBe('#606c38');
  });

  it('routes the accent color to navigation and selection only', () => {
    const vars = buildThemeOverrides({ ...EMPTY_THEME_CUSTOMIZATION, accentColor: '#dda15e' }, off);
    expect(vars['--nav-border-active']).toBe('#dda15e');
    expect(vars['--sc-selection-bg']).toContain('#dda15e');
    expect(vars['--sc-accent']).toBeUndefined();
  });
});

describe('hasThemeCustomization', () => {
  it('detects colors and non-blank custom CSS', () => {
    expect(hasThemeCustomization(EMPTY_THEME_CUSTOMIZATION)).toBe(false);
    expect(hasThemeCustomization({ ...EMPTY_THEME_CUSTOMIZATION, customCss: '  ' })).toBe(false);
    expect(hasThemeCustomization({ ...EMPTY_THEME_CUSTOMIZATION, textColor: '#000000' })).toBe(
      true,
    );
  });
});
