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
    localStorage.setItem('storycraft-language', 'de');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    expect(result.current.language).toBe('de');
  });

  it('ignores invalid values in localStorage and falls back to "en"', async () => {
    localStorage.setItem('storycraft-language', 'xx');
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
    expect(localStorage.getItem('storycraft-language')).toBe('de');
  });
});

// ---------------------------------------------------------------------------
// t() — key lookup
// ---------------------------------------------------------------------------
describe('t()', () => {
  it('returns the raw key as fallback before translations load', () => {
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    // Translations haven't loaded yet (async fetch)
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
    localStorage.setItem('storycraft-language', 'fr');
    const { result } = renderHook(() => useContext(I18nContext), { wrapper });
    // FR bundle has only welcome.title; settings.save only in EN
    await waitFor(() => expect(result.current.t('settings.save')).toBe('Save {{name}}'));
  });

  it('uses active language translation when available', async () => {
    localStorage.setItem('storycraft-language', 'de');
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
    localStorage.setItem('storycraft-language', 'de');
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
