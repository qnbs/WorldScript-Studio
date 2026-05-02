import type { DriveStep } from 'driver.js';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

/** Persisted when the user finishes or closes the spotlight tour. */
export const SPOTLIGHT_TOUR_STORAGE_KEY = 'storycraft-spotlight-tour-done';

export function markSpotlightTourComplete(): void {
  try {
    localStorage.setItem(SPOTLIGHT_TOUR_STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function hasCompletedSpotlightTour(): boolean {
  try {
    return localStorage.getItem(SPOTLIGHT_TOUR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

type Translate = (key: string) => string;

function pickMainNav(): Element | undefined {
  const wide =
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
  const desktop = document.querySelector('[data-tour="sidebar-desktop"]');
  const mobile = document.querySelector('[data-tour="nav-mobile"]');
  return ((wide ? desktop : mobile) ?? desktop ?? mobile) ?? undefined;
}

/**
 * Product tour (driver.js). Highlights sidebar / mobile nav, command palette (desktop), Settings.
 */
export function startSpotlightTour(t: Translate): void {
  const prefersDesktop =
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

  const steps: DriveStep[] = [
    {
      popover: {
        title: t('tour.intro.title'),
        description: t('tour.intro.body'),
        side: 'over',
        align: 'center',
      },
    },
    {
      element: () => pickMainNav() ?? document.body,
      popover: {
        title: t('tour.nav.title'),
        description: t('tour.nav.body'),
        side: prefersDesktop ? 'right' : 'top',
        align: 'start',
      },
    },
  ];

  if (prefersDesktop) {
    const paletteBtn = document.querySelector('[data-tour="command-palette-trigger"]');
    if (paletteBtn) {
      steps.push({
        element: paletteBtn,
        popover: {
          title: t('tour.palette.title'),
          description: t('tour.palette.body'),
          side: 'bottom',
          align: 'center',
        },
      });
    }
  }

  const settingsBtn = document.querySelector('[data-tour="nav-settings"]');
  if (settingsBtn) {
    steps.push({
      element: settingsBtn,
      popover: {
        title: t('tour.settings.title'),
        description: t('tour.settings.body'),
        side: prefersDesktop ? 'right' : 'top',
        align: 'start',
      },
    });
  }

  steps.push({
    popover: {
      title: t('tour.outro.title'),
      description: t('tour.outro.body'),
      side: 'over',
      align: 'center',
    },
  });

  const d = driver({
    showProgress: true,
    progressText: '{{current}} / {{total}}',
    nextBtnText: t('tour.btn.next'),
    prevBtnText: t('tour.btn.prev'),
    doneBtnText: t('tour.btn.done'),
    popoverClass: 'storycraft-driver-popover',
    steps,
    onDestroyed: () => {
      markSpotlightTourComplete();
    },
  });

  d.drive();
}
