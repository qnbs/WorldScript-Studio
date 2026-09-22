import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppearanceBodyClasses } from '../../../hooks/useAppearanceBodyClasses';
import type { Settings } from '../../../types';

// QNBS-v3: extracted from App.tsx — this suite proves the DOM-class/attribute sync for every branch (theme auto/dark/light, sepia color, matchMedia listener lifecycle, portal/writing-surface/accessibility toggles, colorblind attribute, locale dir) independently of the App component.

const baseAccessibility: Settings['accessibility'] = {
  highContrast: false,
  reducedMotion: false,
  reducedTransparency: false,
  largeText: false,
  screenReader: false,
  focusIndicators: false,
  colorBlindMode: 'none',
  presetId: 'custom',
  liveRegionVerbosity: 'normal',
  comfortableTargets: false,
};

type TestSettings = Pick<
  Settings,
  'theme' | 'appearancePreset' | 'writingSurfaceStyle' | 'accessibility'
>;

function buildSettings(overrides: Partial<TestSettings> = {}): TestSettings {
  return {
    theme: 'light',
    appearancePreset: 'default',
    writingSurfaceStyle: 'textured',
    accessibility: baseAccessibility,
    ...overrides,
  };
}

function renderWith(
  settings: TestSettings,
  isPortalActive = false,
  language: 'en' | 'de' | 'ar' = 'en',
  enableRtlLayout = false,
) {
  return renderHook(
    ({ s, portal, lang, rtl }) =>
      useAppearanceBodyClasses({
        settings: s as unknown as Settings,
        isPortalActive: portal,
        language: lang,
        enableRtlLayout: rtl,
      }),
    {
      initialProps: { s: settings, portal: isPortalActive, lang: language, rtl: enableRtlLayout },
    },
  );
}

beforeEach(() => {
  document.body.className = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-colorblind');
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useAppearanceBodyClasses — theme', () => {
  it('applies dark-theme and the default dark theme-color for an explicit dark theme', () => {
    renderWith(buildSettings({ theme: 'dark' }));
    expect(document.body.classList.contains('dark-theme')).toBe(true);
    expect(document.body.classList.contains('light-theme')).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#020617',
    );
    expect(localStorage.getItem('worldscript-theme')).toBe('dark');
  });

  it('applies light-theme and the default light theme-color for an explicit light theme', () => {
    renderWith(buildSettings({ theme: 'light' }));
    expect(document.body.classList.contains('light-theme')).toBe(true);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#ffffff',
    );
    expect(localStorage.getItem('worldscript-theme')).toBe('light');
  });

  it('uses the sepia-specific theme-color for dark and light sepia', () => {
    const { rerender } = renderWith(buildSettings({ theme: 'dark', appearancePreset: 'sepia' }));
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#1c1308',
    );

    rerender({
      s: buildSettings({ theme: 'light', appearancePreset: 'sepia' }),
      portal: false,
      lang: 'en',
      rtl: false,
    });
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#f4ecd8',
    );
  });

  it('reads the system preference and reacts to a live matchMedia change for theme "auto"', () => {
    let changeHandler: ((e: MediaQueryListEvent) => void) | undefined;
    const removeEventListener = vi.fn();
    const addEventListener = vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') changeHandler = handler;
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener, removeEventListener }),
    );

    const { unmount } = renderWith(buildSettings({ theme: 'auto' }));
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(document.body.classList.contains('dark-theme')).toBe(true);

    changeHandler?.({ matches: false } as MediaQueryListEvent);
    expect(document.body.classList.contains('light-theme')).toBe(true);

    unmount();
    // QNBS-v3: asserts the SAME callback reference is removed, not merely "some function" — catches a class of leak where a differently-identitied handler is passed to removeEventListener.
    expect(removeEventListener).toHaveBeenCalledWith('change', changeHandler);
  });

  it('does not throw when the theme-color meta tag is absent', () => {
    document.head.innerHTML = '';
    expect(() => renderWith(buildSettings({ theme: 'dark' }))).not.toThrow();
  });
});

describe('useAppearanceBodyClasses — presentation toggles', () => {
  it('toggles appearance-sepia only for the sepia preset', () => {
    const { rerender } = renderWith(buildSettings({ appearancePreset: 'sepia' }));
    expect(document.body.classList.contains('appearance-sepia')).toBe(true);
    rerender({
      s: buildSettings({ appearancePreset: 'default' }),
      portal: false,
      lang: 'en',
      rtl: false,
    });
    expect(document.body.classList.contains('appearance-sepia')).toBe(false);
  });

  it('toggles portal-active from isPortalActive', () => {
    renderWith(buildSettings(), true);
    expect(document.body.classList.contains('portal-active')).toBe(true);
  });

  it('removes portal-active on unmount so a later mount never inherits stale decoration', () => {
    const { unmount } = renderWith(buildSettings(), true);
    expect(document.body.classList.contains('portal-active')).toBe(true);
    unmount();
    expect(document.body.classList.contains('portal-active')).toBe(false);
  });

  it('toggles writing-surface-plain only for the plain style', () => {
    renderWith(buildSettings({ writingSurfaceStyle: 'plain' }));
    expect(document.body.classList.contains('writing-surface-plain')).toBe(true);
  });
});

describe('useAppearanceBodyClasses — accessibility', () => {
  it('toggles high-contrast, reduced-motion, and reduced-transparency independently', () => {
    renderWith(
      buildSettings({
        accessibility: {
          ...baseAccessibility,
          highContrast: true,
          reducedMotion: true,
          reducedTransparency: true,
        },
      }),
    );
    expect(document.body.classList.contains('accessibility-high-contrast')).toBe(true);
    expect(document.body.classList.contains('worldscript-reduced-motion')).toBe(true);
    expect(document.body.classList.contains('worldscript-reduced-transparency')).toBe(true);
  });

  it('applies the motor/screen-reader cluster onto documentElement and body', () => {
    renderWith(
      buildSettings({
        accessibility: {
          ...baseAccessibility,
          largeText: true,
          screenReader: true,
          focusIndicators: true,
          comfortableTargets: true,
        },
      }),
    );
    expect(document.documentElement.classList.contains('worldscript-large-text')).toBe(true);
    expect(document.body.classList.contains('worldscript-screen-reader')).toBe(true);
    expect(document.body.classList.contains('worldscript-focus-indicators')).toBe(true);
    expect(document.body.classList.contains('accessibility-comfortable-targets')).toBe(true);
  });

  it('sets data-colorblind for a real mode and removes it for "none"', () => {
    const { rerender } = renderWith(
      buildSettings({ accessibility: { ...baseAccessibility, colorBlindMode: 'protanopia' } }),
    );
    expect(document.documentElement.getAttribute('data-colorblind')).toBe('protanopia');

    rerender({
      s: buildSettings({ accessibility: { ...baseAccessibility, colorBlindMode: 'none' } }),
      portal: false,
      lang: 'en',
      rtl: false,
    });
    expect(document.documentElement.hasAttribute('data-colorblind')).toBe(false);
  });
});

describe('useAppearanceBodyClasses — locale', () => {
  it('sets lang and ltr dir for a non-RTL locale', () => {
    renderWith(buildSettings(), false, 'en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('sets rtl dir for a genuinely RTL locale', () => {
    renderWith(buildSettings(), false, 'ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('forces rtl when enableRtlLayout overrides a non-RTL locale', () => {
    renderWith(buildSettings(), false, 'en', true);
    expect(document.documentElement.dir).toBe('rtl');
  });
});
