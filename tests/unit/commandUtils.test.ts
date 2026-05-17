/**
 * Tests for small, pure command utility modules:
 * effectiveTheme, wordCountApprox, commandTypes (COMMAND_CATEGORY_I18N).
 * QNBS-v3: Covers 3 previously untested command helper files.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_CATEGORY_I18N } from '../../services/commands/commandTypes';
import { getEffectiveTheme } from '../../services/commands/effectiveTheme';
import { approximateManuscriptWordCount } from '../../services/commands/wordCountApprox';

// ---------------------------------------------------------------------------
// getEffectiveTheme
// ---------------------------------------------------------------------------

describe('getEffectiveTheme', () => {
  it('returns "dark" for "dark" input', () => {
    expect(getEffectiveTheme('dark')).toBe('dark');
  });

  it('returns "light" for "light" input', () => {
    expect(getEffectiveTheme('light')).toBe('light');
  });

  it('falls back to system preference when theme is "system"', () => {
    // jsdom defaults to light (matchMedia returns false for dark)
    const result = getEffectiveTheme('auto');
    expect(['light', 'dark']).toContain(result);
  });

  it('returns "dark" when window is not defined (SSR-like)', () => {
    // QNBS-v3: SSR-safety — window.matchMedia may be absent on server or old envs.
    const original = window.matchMedia;
    // @ts-expect-error intentional for test
    delete window.matchMedia;
    const result = getEffectiveTheme('auto');
    expect(result).toBe('dark');
    window.matchMedia = original;
  });
});

// ---------------------------------------------------------------------------
// approximateManuscriptWordCount
// ---------------------------------------------------------------------------

describe('approximateManuscriptWordCount', () => {
  it('returns 0 for undefined data', () => {
    expect(approximateManuscriptWordCount(undefined)).toBe(0);
  });

  it('returns 0 for empty manuscript array', () => {
    expect(approximateManuscriptWordCount({ manuscript: [] } as never)).toBe(0);
  });

  it('counts words across multiple sections', () => {
    const data = {
      manuscript: [{ content: 'Hello world' }, { content: 'Foo bar baz' }],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(5);
  });

  it('strips HTML tags before counting', () => {
    const data = {
      manuscript: [{ content: '<p>Hello <strong>world</strong></p>' }],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(2);
  });

  it('handles sections with no content (empty string)', () => {
    const data = {
      manuscript: [{ content: '' }, { content: 'one' }],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(1);
  });

  it('handles sections with undefined content', () => {
    const data = {
      manuscript: [{ content: undefined }, { content: 'three words here' }],
    } as never;
    expect(approximateManuscriptWordCount(data)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// COMMAND_CATEGORY_I18N
// ---------------------------------------------------------------------------

describe('COMMAND_CATEGORY_I18N', () => {
  const expectedCategories = [
    'navigation',
    'aiActions',
    'projectManagement',
    'editor',
    'settings',
    'help',
    'global',
    'customUser',
  ] as const;

  it('has entries for all expected categories', () => {
    for (const cat of expectedCategories) {
      expect(COMMAND_CATEGORY_I18N[cat]).toBeTruthy();
    }
  });

  it('all values are i18n key strings starting with "palette.category."', () => {
    for (const key of Object.values(COMMAND_CATEGORY_I18N)) {
      expect(key).toMatch(/^palette\.category\./);
    }
  });
});
