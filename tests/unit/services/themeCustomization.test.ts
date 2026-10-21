import { describe, expect, it } from 'vitest';
import {
  buildThemeOverrides,
  contrastRatio,
  EMPTY_THEME_CUSTOMIZATION,
  hasThemeCustomization,
  MAX_CUSTOM_CSS_LENGTH,
  normalizeThemeCustomization,
  pickOnAccentText,
  sanitizeCustomCss,
} from '../../../services/themeCustomization';

const off = { highContrast: false };

describe('normalizeThemeCustomization', () => {
  it('treats the never-applied pre-#702 defaults as unset', () => {
    expect(
      normalizeThemeCustomization({
        primaryColor: '#3b82f6',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        backgroundColor: '#0f172a',
        textColor: '#f8fafc',
        customCss: '',
      }),
    ).toEqual(EMPTY_THEME_CUSTOMIZATION);
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
    expect(pickOnAccentText('#fde047')).toBe('#0f172a');
    expect(pickOnAccentText('#1e3a8a')).toBe('#ffffff');
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
    expect(vars['--sc-text-on-accent']).toBe('#ffffff');
    expect(vars['--sc-border-focus']).toBe('#1e3a8a');
    expect(vars['--sc-ring-focus']).toContain('#1e3a8a');
  });

  it('leaves borders and focus rings to high contrast', () => {
    const vars = buildThemeOverrides(
      { ...EMPTY_THEME_CUSTOMIZATION, primaryColor: '#1e3a8a', backgroundColor: '#ffffff' },
      { highContrast: true },
    );
    expect(vars['--sc-accent']).toBe('#1e3a8a');
    expect(vars['--sc-border-focus']).toBeUndefined();
    expect(vars['--sc-ring-focus']).toBeUndefined();
    expect(vars['--sc-border-subtle']).toBeUndefined();
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
