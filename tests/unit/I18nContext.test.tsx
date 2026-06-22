import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { useContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nContext, I18nProvider } from '../../contexts/I18nContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EN_BUNDLE: Record<string, string> = {
  'welcome.title': 'Welcome',
  'settings.save': 'Save {{name}}',
  'shared.key': 'EN shared',
};
const DE_BUNDLE: Record<string, string> = {
  'welcome.title': 'Willkommen',
  'shared.key': 'DE shared',
};
const FR_BUNDLE: Record<string, string> = {
  'welcome.title': 'Bienvenue',
};

const bundles: Record<string, Record<string, string>> = {
  en: EN_BUNDLE,
  de: DE_BUNDLE,
  fr: FR_BUNDLE,
  ar: EN_BUNDLE, // QNBS-v3: ar bundle uses EN for testing (Beta)
  he: EN_BUNDLE, // QNBS-v3: he bundle uses EN for testing (Beta)
  ja: EN_BUNDLE, // QNBS-v3: ja bundle uses EN for testing (Beta)
  zh: EN_BUNDLE, // QNBS-v3: zh bundle uses EN for testing (Beta)
  pt: EN_BUNDLE, // QNBS-v3: pt bundle uses EN for testing (Beta)
  el: EN_BUNDLE, // QNBS-v3: el bundle uses EN for testing (Beta)
};

function makeOkResponse(data: Record<string, string>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

const mockFetch = vi.fn((url: string) => {
  const match = (url as string).match(/locales\/(\w+)\/bundle\.json$/);
  const lang = match?.[1];
  if (lang && bundles[lang]) return makeOkResponse(bundles[lang]);
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
});

// Provider wrapper factory for renderHook
function wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('fetch', mockFetch);
});

// ---------------------------------------------------------------------------
// Initial language detection
// ---------------------------------------------------------------------------
describe('initial language detection', () => {
  it('defaults to "en" when localStorage has no saved language', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    expect(result.current.language).toBe('en');
  });

  it('restores language from localStorage', async () => {
    localStorage.setItem('worldscript-language', 'de');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    expect(result.current.language).toBe('de');
  });

  it('ignores invalid values in localStorage and falls back to "en"', async () => {
    localStorage.setItem('worldscript-language', 'xx');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    expect(result.current.language).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// setLanguage
// ---------------------------------------------------------------------------
describe('setLanguage', () => {
  it('updates language state', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    act(() => {
      result.current.setLanguage('fr');
    });
    expect(result.current.language).toBe('fr');
  });

  it('persists the new language to localStorage', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    act(() => {
      result.current.setLanguage('de');
    });
    expect(localStorage.getItem('worldscript-language')).toBe('de');
  });
});

// ---------------------------------------------------------------------------
// t() — key lookup
// ---------------------------------------------------------------------------
describe('t()', () => {
  it('returns bootstrap strings for critical keys before bundle loads', () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    expect(result.current.t('initialProject.title')).toBe('My Untitled Story');
    expect(result.current.t('welcome.title')).toBe('welcome.title');
  });

  it('returns translated string after EN bundle loads', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.t('welcome.title')).toBe('Welcome'));
  });

  it('substitutes {{placeholder}} replacements', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() =>
      expect(result.current.t('settings.save', { name: 'Draft' })).toBe('Save Draft'),
    );
  });

  it('falls back to EN when active language lacks a key', async () => {
    localStorage.setItem('worldscript-language', 'fr');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    // FR bundle has only welcome.title; settings.save only in EN
    await waitFor(() => expect(result.current.t('settings.save')).toBe('Save {{name}}'));
  });

  it('uses active language translation when available', async () => {
    localStorage.setItem('worldscript-language', 'de');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.t('welcome.title')).toBe('Willkommen'));
  });
});

// ---------------------------------------------------------------------------
// Bundle loading
// ---------------------------------------------------------------------------
describe('bundle loading', () => {
  it('fetches the active language bundle on mount', async () => {
    renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('/en/bundle.json'))).toBe(true);
    });
  });

  it('also fetches EN as fallback when active language is not EN', async () => {
    localStorage.setItem('worldscript-language', 'de');
    renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('/de/bundle.json'))).toBe(true);
      expect(urls.some((u) => u.includes('/en/bundle.json'))).toBe(true);
    });
  });

  it('does not fetch EN twice when active language is EN', async () => {
    renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => {
      const enCalls = mockFetch.mock.calls.filter((c) =>
        (c[0] as string).includes('/en/bundle.json'),
      );
      expect(enCalls.length).toBe(1);
    });
  });

  it('handles fetch errors gracefully (returns key as fallback)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    // Should not throw — t() falls back to key
    await waitFor(() => expect(typeof result.current.t('welcome.title')).toBe('string'));
  });

  it('handles non-ok HTTP responses gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(typeof result.current.t('welcome.title')).toBe('string'));
  });
});

// ---------------------------------------------------------------------------
// document.documentElement.lang
// ---------------------------------------------------------------------------
describe('document lang attribute', () => {
  it('sets document.documentElement.lang on language change', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    act(() => {
      result.current.setLanguage('de');
    });
    expect(document.documentElement.lang).toBe('de');
  });
});

// ---------------------------------------------------------------------------
// Intl.PluralRules
// ---------------------------------------------------------------------------
describe('Intl.PluralRules', () => {
  it('returns plural category for count', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.getPluralCategory(1)).toBe('one');
    expect(result.current.getPluralCategory(2)).toBe('other');
    expect(result.current.getPluralCategory(0)).toBe('other');
  });

  it('returns correct plural category for Arabic zero', async () => {
    localStorage.setItem('worldscript-language', 'ar');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.getPluralCategory(0)).toBe('zero');
  });
});

// ---------------------------------------------------------------------------
// Intl.NumberFormat
// ---------------------------------------------------------------------------
describe('Intl.NumberFormat', () => {
  it('formats numbers with locale-aware grouping', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatNumber(1234567)).toBe('1,234,567');
  });

  it('formats numbers with percent style', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatNumber(0.875, { style: 'percent' })).toBe('88%');
  });

  it('formats numbers with compact notation', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // QNBS-v3: Compact notation varies by locale; just verify it formats
    const formatted = result.current.formatNumber(1500000, { notation: 'compact' });
    expect(formatted).toMatch(/1\.5M|2M|1,5M|2 MD/);
  });
});

// ---------------------------------------------------------------------------
// Intl.RelativeTimeFormat
// ---------------------------------------------------------------------------
describe('Intl.RelativeTimeFormat', () => {
  it('formats relative time with auto numeric', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatRelativeTime(-1, 'day')).toBe('yesterday');
    expect(result.current.formatRelativeTime(1, 'day')).toBe('tomorrow');
  });

  it('formats relative time with numeric values', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatRelativeTime(-2, 'day')).toBe('2 days ago');
    expect(result.current.formatRelativeTime(3, 'hour')).toBe('in 3 hours');
  });
});

// ---------------------------------------------------------------------------
// Intl.Collator
// ---------------------------------------------------------------------------
describe('Intl.Collator', () => {
  it('sorts strings with locale-aware comparison', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const collator = result.current.getCollator();
    expect(collator.compare('a', 'b')).toBeLessThan(0);
    expect(collator.compare('b', 'a')).toBeGreaterThan(0);
    expect(collator.compare('a', 'a')).toBe(0);
  });

  it('sorts numeric strings correctly', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const collator = result.current.getCollator();
    // Numeric: "Chapter 2" should come before "Chapter 10"
    expect(collator.compare('Chapter 2', 'Chapter 10')).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Intl.ListFormat
// ---------------------------------------------------------------------------
describe('Intl.ListFormat', () => {
  it('formats list with conjunction', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatList(['A', 'B', 'C'])).toBe('A, B, and C');
  });

  it('formats list with disjunction', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatList(['Yes', 'No'], { type: 'disjunction' })).toBe('Yes or No');
  });
});

// ---------------------------------------------------------------------------
// Intl.DisplayNames
// ---------------------------------------------------------------------------
describe('Intl.DisplayNames', () => {
  it('formats language display names', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatDisplayName('en', 'language')).toBe('English');
    expect(result.current.formatDisplayName('ja', 'language')).toBe('Japanese');
  });

  it('formats region display names', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatDisplayName('US', 'region')).toBe('United States');
    expect(result.current.formatDisplayName('DE', 'region')).toBe('Germany');
  });

  it('formats script display names', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatDisplayName('Latn', 'script')).toBe('Latin');
    expect(result.current.formatDisplayName('Cyrl', 'script')).toBe('Cyrillic');
  });

  it('falls back to input value when not found', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatDisplayName('xyz', 'language')).toBe('xyz');
  });
});

// ---------------------------------------------------------------------------
// Intl.PluralRules - Extended coverage
// ---------------------------------------------------------------------------
describe('Intl.PluralRules - Extended', () => {
  it('returns correct plural for Japanese', async () => {
    localStorage.setItem('worldscript-language', 'ja');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // Japanese uses 'other' for all counts (no plural forms)
    expect(result.current.getPluralCategory(1)).toBe('other');
    expect(result.current.getPluralCategory(2)).toBe('other');
    expect(result.current.getPluralCategory(100)).toBe('other');
  });

  it('returns correct plural for Chinese', async () => {
    localStorage.setItem('worldscript-language', 'zh');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // Chinese uses 'other' for all counts
    expect(result.current.getPluralCategory(0)).toBe('other');
    expect(result.current.getPluralCategory(1)).toBe('other');
  });

  it('returns correct plural for Portuguese', async () => {
    localStorage.setItem('worldscript-language', 'pt');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // Portuguese has 'one' and 'other'
    expect(result.current.getPluralCategory(1)).toBe('one');
    expect(result.current.getPluralCategory(2)).toBe('other');
  });

  it('returns correct plural for Greek', async () => {
    localStorage.setItem('worldscript-language', 'el');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // Greek has 'one' and 'other'
    expect(result.current.getPluralCategory(1)).toBe('one');
    expect(result.current.getPluralCategory(2)).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// Intl.NumberFormat - Extended coverage
// ---------------------------------------------------------------------------
describe('Intl.NumberFormat - Extended', () => {
  it('formats currency values', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const formatted = result.current.formatNumber(1234.56, {
      style: 'currency',
      currency: 'USD',
    });
    // QNBS-v3: Currency format varies by locale; just verify it formats with $
    expect(formatted).toMatch(/\$/);
  });

  it('formats with custom fraction digits', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatNumber(1234.567, { maximumFractionDigits: 2 })).toBe('1,234.57');
  });

  it('formats zero correctly', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatNumber(0)).toBe('0');
  });

  it('formats negative numbers', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatNumber(-1234)).toBe('-1,234');
  });
});

// ---------------------------------------------------------------------------
// Intl.RelativeTimeFormat - Extended coverage
// ---------------------------------------------------------------------------
describe('Intl.RelativeTimeFormat - Extended', () => {
  it('formats hours correctly', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatRelativeTime(-1, 'hour')).toBe('1 hour ago');
    expect(result.current.formatRelativeTime(2, 'hour')).toBe('in 2 hours');
  });

  it('formats weeks correctly', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatRelativeTime(-1, 'week')).toBe('last week');
    expect(result.current.formatRelativeTime(1, 'week')).toBe('next week');
  });

  it('formats months correctly', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatRelativeTime(-2, 'month')).toBe('2 months ago');
    expect(result.current.formatRelativeTime(3, 'month')).toBe('in 3 months');
  });

  it('formats years correctly', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatRelativeTime(-1, 'year')).toBe('last year');
    expect(result.current.formatRelativeTime(1, 'year')).toBe('next year');
  });
});

// ---------------------------------------------------------------------------
// Intl.Collator - Extended coverage
// ---------------------------------------------------------------------------
describe('Intl.Collator - Extended', () => {
  it('sorts strings case-insensitively', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const collator = result.current.getCollator({ sensitivity: 'base' });
    expect(collator.compare('a', 'A')).toBe(0);
    expect(collator.compare('a', 'b')).toBeLessThan(0);
  });

  it('sorts with different locales', async () => {
    localStorage.setItem('worldscript-language', 'de');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const collator = result.current.getCollator();
    // German umlaut sorting
    expect(collator.compare('ä', 'z')).toBeLessThan(0);
  });

  it('handles empty strings', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const collator = result.current.getCollator();
    expect(collator.compare('', '')).toBe(0);
    expect(collator.compare('', 'a')).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Intl.ListFormat - Extended coverage
// ---------------------------------------------------------------------------
describe('Intl.ListFormat - Extended', () => {
  it('formats list with unit type', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatList(['kg', 'g', 'mg'], { type: 'unit' })).toMatch(
      /kg, g, and mg|kg, g, mg/,
    );
  });

  it('formats short style list', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const formatted = result.current.formatList(['A', 'B', 'C'], { style: 'short' });
    // QNBS-v3: Short style format varies by locale (e.g., "A, B, & C" in en)
    expect(formatted).toMatch(/A.*B.*C/);
  });

  it('handles single item list', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatList(['Only one'])).toBe('Only one');
  });

  it('handles empty list', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.formatList([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_LOCALES metadata
// ---------------------------------------------------------------------------
describe('SUPPORTED_LOCALES', () => {
  it('exposes the full locale registry (matches LOCALE_CODES)', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // QNBS-v3: assert against the SSOT registry rather than a magic count, so adding a language does
    // not break this test — the canonical registry==filesystem integrity check lives in
    // tests/unit/i18n/localesRegistry.test.ts. The floor guards against an empty/broken derivation.
    const { SUPPORTED_LOCALES } = await import('../../contexts/I18nContext');
    const { LOCALE_CODES } = await import('../../i18n/locales');
    expect(SUPPORTED_LOCALES.map((l) => l.code).sort()).toEqual([...LOCALE_CODES].sort());
    expect(SUPPORTED_LOCALES.length).toBeGreaterThanOrEqual(18);
  });

  it('marks ar, he and fa as RTL beta', async () => {
    const { SUPPORTED_LOCALES } = await import('../../contexts/I18nContext');
    const arLocale = SUPPORTED_LOCALES.find((l) => l.code === 'ar');
    const heLocale = SUPPORTED_LOCALES.find((l) => l.code === 'he');
    const faLocale = SUPPORTED_LOCALES.find((l) => l.code === 'fa');
    expect(arLocale?.dir).toBe('rtl');
    expect(arLocale?.isBeta).toBe(true);
    expect(heLocale?.dir).toBe('rtl');
    expect(heLocale?.isBeta).toBe(true);
    // QNBS-v3: Phase X — Persian is the third RTL locale (Arabic script).
    expect(faLocale?.dir).toBe('rtl');
    expect(faLocale?.isBeta).toBe(true);
    expect(faLocale?.fontScript).toBe('arabic');
  });

  it('marks fi, sv, hu, is, eu as LTR beta', async () => {
    const { SUPPORTED_LOCALES } = await import('../../contexts/I18nContext');
    for (const code of ['fi', 'sv', 'hu', 'is', 'eu'] as const) {
      const locale = SUPPORTED_LOCALES.find((l) => l.code === code);
      expect(locale, `${code} should be present`).toBeDefined();
      expect(locale?.dir).toBe('ltr');
      expect(locale?.isBeta).toBe(true);
    }
  });

  it('marks ja, zh, pt, el as beta', async () => {
    const { SUPPORTED_LOCALES } = await import('../../contexts/I18nContext');
    const jaLocale = SUPPORTED_LOCALES.find((l) => l.code === 'ja');
    const zhLocale = SUPPORTED_LOCALES.find((l) => l.code === 'zh');
    const ptLocale = SUPPORTED_LOCALES.find((l) => l.code === 'pt');
    const elLocale = SUPPORTED_LOCALES.find((l) => l.code === 'el');
    expect(jaLocale?.isBeta).toBe(true);
    expect(zhLocale?.isBeta).toBe(true);
    expect(ptLocale?.isBeta).toBe(true);
    expect(elLocale?.isBeta).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Intl.Segmenter - countWords
// QNBS-v3: CJK word counts are ICU/engine-dependent; tests verify non-zero counts
// and monotonic behavior rather than exact token counts for cross-environment stability.
// ---------------------------------------------------------------------------
describe('countWords', () => {
  it('counts words in English text', async () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.countWords('Hello world')).toBe(2);
    expect(result.current.countWords('One two three four')).toBe(4);
    expect(result.current.countWords('')).toBe(0);
    expect(result.current.countWords('   ')).toBe(0);
  });

  it('counts words in Japanese text using Intl.Segmenter', async () => {
    localStorage.setItem('worldscript-language', 'ja');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // QNBS-v3: Intl.Segmenter word boundaries are ICU-dependent; verify non-zero counts
    // and monotonic behavior rather than exact counts for cross-environment stability.
    const shortText = 'こんにちは世界';
    const longText = 'これはテストです';
    expect(result.current.countWords(shortText)).toBeGreaterThan(0);
    expect(result.current.countWords(longText)).toBeGreaterThan(
      result.current.countWords(shortText),
    );
    // Verify empty/blank handling
    expect(result.current.countWords('')).toBe(0);
    expect(result.current.countWords('　')).toBe(0); // full-width space
  });

  it('counts words in Chinese text using Intl.Segmenter', async () => {
    localStorage.setItem('worldscript-language', 'zh');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    // QNBS-v3: Intl.Segmenter word boundaries are ICU-dependent; verify non-zero counts
    // and monotonic behavior rather than exact counts for cross-environment stability.
    const shortText = '你好世界';
    const longText = '这是一个测试';
    expect(result.current.countWords(shortText)).toBeGreaterThan(0);
    expect(result.current.countWords(longText)).toBeGreaterThan(
      result.current.countWords(shortText),
    );
    // Verify empty/blank handling
    expect(result.current.countWords('')).toBe(0);
    expect(result.current.countWords('   ')).toBe(0);
  });

  it('counts words in Portuguese text', async () => {
    localStorage.setItem('worldscript-language', 'pt');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.countWords('Olá mundo')).toBe(2);
    expect(result.current.countWords('Esta é uma história')).toBe(4);
  });

  it('counts words in Greek text', async () => {
    localStorage.setItem('worldscript-language', 'el');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.countWords('Γεια σου κόσμε')).toBe(3);
    expect(result.current.countWords('Αυτή είναι μια ιστορία')).toBe(4);
  });
});
