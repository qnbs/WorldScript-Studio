import { useEffect, useState } from 'react';
import { RTL_LOCALES } from '../contexts/I18nContext';
import type { Language } from '../i18n/locales';
import { buildThemeOverrides, normalizeThemeCustomization } from '../services/themeCustomization';
import type { Settings, ThemeCustomization } from '../types';

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
  const prefersMoreContrast = usePrefersMoreContrast();
  useThemeCustomization(
    settings.themeCustomization,
    settings.accessibility.highContrast || prefersMoreContrast,
  );
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

// QNBS-v3 (#702): set by the customization effect so the auto-theme listener keeps a custom background in the browser chrome.
let customThemeColor: string | null = null;
// QNBS-v3 (#702): the theme's own chrome color, so clearing a custom background can restore it without waiting for a theme switch.
let themeChromeColor: string | null = null;

function resolveThemeColor(
  appearancePreset: Settings['appearancePreset'],
  isDark: boolean,
): string {
  if (appearancePreset === 'sepia') return isDark ? '#1c1308' : '#f4ecd8';
  return isDark ? '#020617' : '#ffffff';
}

// QNBS-v3 (#702): index.html ships one theme-color per prefers-color-scheme; the app's own theme can differ from the OS scheme, so every tag must carry it.
function setThemeColorMeta(color: string): void {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', color);
  }
}

function applyThemeClass(appearancePreset: Settings['appearancePreset'], isDark: boolean): void {
  document.body.classList.remove('light-theme', 'dark-theme');
  document.body.classList.add(isDark ? 'dark-theme' : 'light-theme');
  // QNBS-v3: reflect the theme color in mobile browser chrome so the status bar matches the app shell.
  themeChromeColor = resolveThemeColor(appearancePreset, isDark);
  setThemeColorMeta(customThemeColor ?? themeChromeColor);
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

const USER_CSS_ELEMENT_ID = 'worldscript-user-css';
const appliedThemeVars = new Set<string>();

function applyUserCss(css: string): void {
  let element = document.getElementById(USER_CSS_ELEMENT_ID) as HTMLStyleElement | null;
  if (css.trim() === '') {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('style');
    element.id = USER_CSS_ELEMENT_ID;
    document.head.appendChild(element);
  }
  // QNBS-v3 (#702): textContent only — never parsed as HTML, and CSP (style-src/img-src/font-src) still blocks remote loads.
  element.textContent = css;
}

function applyThemeCustomization(customization: ThemeCustomization, highContrast: boolean): void {
  const vars = buildThemeOverrides(customization, { highContrast });
  const style = document.body.style;
  for (const name of appliedThemeVars) {
    if (!(name in vars)) style.removeProperty(name);
  }
  appliedThemeVars.clear();
  for (const [name, value] of Object.entries(vars)) {
    style.setProperty(name, value);
    appliedThemeVars.add(name);
  }
  // QNBS-v3 (#702): the ::selection rule reads --sc-selection-bg, which high contrast removes; native highlighting returns with it.
  document.body.toggleAttribute(
    'data-custom-highlight',
    !highContrast && customization.accentColor !== '',
  );
  customThemeColor = highContrast ? null : customization.backgroundColor || null;
  const chromeColor = customThemeColor ?? themeChromeColor;
  if (chromeColor) setThemeColorMeta(chromeColor);
  applyUserCss(customization.customCss);
}

const MORE_CONTRAST_QUERY = '(prefers-contrast: more)';

// QNBS-v3 (#702): the OS-level contrast preference has its own border rules in index.css; customization must yield to it like to the in-app toggle.
function usePrefersMoreContrast(): boolean {
  const [prefersMore, setPrefersMore] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(MORE_CONTRAST_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(MORE_CONTRAST_QUERY);
    const handler = (e: MediaQueryListEvent) => setPrefersMore(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return prefersMore;
}

// QNBS-v3 (#702/#818): inline body tokens outrank the theme/preset classes and survive class switches; the browser-chrome color follows via customThemeColor.
function useThemeCustomization(
  themeCustomization: Settings['themeCustomization'] | undefined,
  highContrast: boolean,
): void {
  useEffect(() => {
    applyThemeCustomization(normalizeThemeCustomization(themeCustomization), highContrast);
  }, [themeCustomization, highContrast]);
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
