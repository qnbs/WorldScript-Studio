import { useEffect } from 'react';
import { RTL_LOCALES } from '../contexts/I18nContext';
import type { Language } from '../i18n/locales';
import type { Settings } from '../types';

export interface UseAppearanceBodyClassesParams {
  settings: Settings;
  isPortalActive: boolean;
  language: Language;
  enableRtlLayout: boolean;
}

// QNBS-v3: extracted from App.tsx (CodeScene "Complex Method" hotspot) — every one of these effects reads settings/portal/language and syncs a DOM class or attribute; none touch component-local state, so grouping them here keeps App's own function from growing with each new appearance toggle.
/** Syncs theme/appearance/accessibility/portal-decoration settings onto document body/html classes and attributes. */
export function useAppearanceBodyClasses(params: UseAppearanceBodyClassesParams): void {
  const { settings, isPortalActive, language, enableRtlLayout } = params;
  useThemeClass(settings.theme, settings.appearancePreset);
  useSepiaClass(settings.appearancePreset);
  usePortalActiveClass(isPortalActive);
  useWritingSurfacePlainClass(settings.writingSurfaceStyle);
  useHighContrastClass(settings.accessibility.highContrast);
  useReducedMotionClass(settings.accessibility.reducedMotion);
  useReducedTransparencyClass(settings.accessibility.reducedTransparency);
  useMotorAndScreenReaderClasses(settings.accessibility);
  useColorBlindAttribute(settings.accessibility.colorBlindMode);
  useDocumentLocale(language, enableRtlLayout);
}

function resolveThemeColor(
  appearancePreset: Settings['appearancePreset'],
  isDark: boolean,
): string {
  if (appearancePreset === 'sepia') return isDark ? '#1c1308' : '#f4ecd8';
  return isDark ? '#020617' : '#ffffff';
}

function applyThemeClass(appearancePreset: Settings['appearancePreset'], isDark: boolean): void {
  document.body.classList.remove('light-theme', 'dark-theme');
  document.body.classList.add(isDark ? 'dark-theme' : 'light-theme');
  // QNBS-v3: reflect the theme color in mobile browser chrome so the status bar matches the app shell.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolveThemeColor(appearancePreset, isDark));
  try {
    localStorage.setItem('worldscript-theme', isDark ? 'dark' : 'light');
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded)
  }
}

// QNBS-v3: split to its own function (CodeScene) — the only effect here with real branching (auto/dark/light + a live matchMedia listener), everything else in this file is a one-line class toggle.
function useThemeClass(
  theme: Settings['theme'],
  appearancePreset: Settings['appearancePreset'],
): void {
  useEffect(() => {
    if (theme !== 'auto') {
      applyThemeClass(appearancePreset, theme === 'dark');
      return undefined;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    applyThemeClass(appearancePreset, mq.matches);
    const handler = (e: MediaQueryListEvent) => applyThemeClass(appearancePreset, e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, appearancePreset]);
}

// QNBS-v3: Appearance presets → body class (pairs with index.css tokens).
function useSepiaClass(appearancePreset: Settings['appearancePreset']): void {
  useEffect(() => {
    document.body.classList.toggle('appearance-sepia', appearancePreset === 'sepia');
  }, [appearancePreset]);
}

// QNBS-v3 (Visual Maturity #A): Aurora/noise are a Welcome Portal brand moment, not a global whole-app ambience — cleanup removes the class on unmount so a stale mount can never leave decoration on outside the portal (unlike the other classes here, this one is a transient "currently showing" flag, not durable document state).
function usePortalActiveClass(isPortalActive: boolean): void {
  useEffect(() => {
    document.body.classList.toggle('portal-active', isPortalActive);
    return () => document.body.classList.remove('portal-active');
  }, [isPortalActive]);
}

// QNBS-v3: Decorative fixed layers are opt-out so long-form writers can keep a neutral canvas.
function useWritingSurfacePlainClass(writingSurfaceStyle: Settings['writingSurfaceStyle']): void {
  useEffect(() => {
    document.body.classList.toggle('writing-surface-plain', writingSurfaceStyle === 'plain');
  }, [writingSurfaceStyle]);
}

function useHighContrastClass(highContrast: boolean): void {
  useEffect(() => {
    document.body.classList.toggle('accessibility-high-contrast', highContrast);
  }, [highContrast]);
}

function useReducedMotionClass(reducedMotion: boolean): void {
  useEffect(() => {
    document.body.classList.toggle('worldscript-reduced-motion', reducedMotion);
  }, [reducedMotion]);
}

// QNBS-v3 (#332/D4): manual relief valve for backdrop-blur GPU cost, mirroring reducedMotion — covers OS/DE setups (some Linux/Wayland) that don't expose prefers-reduced-transparency.
function useReducedTransparencyClass(reducedTransparency: boolean): void {
  useEffect(() => {
    document.body.classList.toggle('worldscript-reduced-transparency', reducedTransparency);
  }, [reducedTransparency]);
}

// QNBS-v3: Barrierefreiheits-Toggles → dokumentweite Klassen (Tokens in index.css).
function useMotorAndScreenReaderClasses(accessibility: Settings['accessibility']): void {
  useEffect(() => {
    document.documentElement.classList.toggle('worldscript-large-text', accessibility.largeText);
    document.body.classList.toggle('worldscript-screen-reader', accessibility.screenReader);
    document.body.classList.toggle('worldscript-focus-indicators', accessibility.focusIndicators);
    document.body.classList.toggle(
      'accessibility-comfortable-targets',
      accessibility.comfortableTargets,
    );
  }, [
    accessibility.largeText,
    accessibility.screenReader,
    accessibility.focusIndicators,
    accessibility.comfortableTargets,
  ]);
}

function useColorBlindAttribute(colorBlindMode: Settings['accessibility']['colorBlindMode']): void {
  useEffect(() => {
    if (colorBlindMode === 'none') {
      document.documentElement.removeAttribute('data-colorblind');
    } else {
      document.documentElement.setAttribute('data-colorblind', colorBlindMode);
    }
  }, [colorBlindMode]);
}

// QNBS-v3: HTML lang + dir — locale drives direction; enableRtlLayout flag overrides for manual RTL testing.
function useDocumentLocale(language: Language, enableRtlLayout: boolean): void {
  useEffect(() => {
    document.documentElement.lang = language;
    const localeDir = RTL_LOCALES.has(language) ? 'rtl' : 'ltr';
    document.documentElement.dir = enableRtlLayout ? 'rtl' : localeDir;
  }, [language, enableRtlLayout]);
}
