/**
 * Audio Navigator — ARIA-compatible focus management and audio landmark navigation.
 * QNBS-v3: Ensures WCAG 2.2 compliance for voice-driven interactions.
 */

import { logger } from '../logger';

export interface AudioLandmark {
  role: string;
  label: string;
  element: HTMLElement;
}

export class AudioNavigator {
  private landmarks: AudioLandmark[] = [];
  private currentLandmarkIndex = -1;

  /** Scan document for ARIA landmarks and focusable regions */
  scanLandmarks(): void {
    const selectors = [
      '[role="main"]',
      '[role="navigation"]',
      '[role="complementary"]',
      '[role="search"]',
      '[role="region"][aria-label]',
      'main',
      'nav',
      'aside',
    ];

    const elements = document.querySelectorAll<HTMLElement>(selectors.join(', '));
    this.landmarks = Array.from(elements).map((el) => ({
      role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
      label:
        el.getAttribute('aria-label') ??
        el.getAttribute('aria-labelledby') ??
        el.getAttribute('title') ??
        'Unnamed region',
      element: el,
    }));

    logger.debug('Audio landmarks scanned:', this.landmarks.length);
  }

  /** Focus next landmark and return its label for TTS */
  nextLandmark(): string | null {
    if (this.landmarks.length === 0) {
      this.scanLandmarks();
    }
    if (this.landmarks.length === 0) return null;

    this.currentLandmarkIndex = (this.currentLandmarkIndex + 1) % this.landmarks.length;
    const landmark = this.landmarks[this.currentLandmarkIndex];
    if (!landmark) return null;

    this.focusElement(landmark.element);
    return `${landmark.label}, ${landmark.role}`;
  }

  /** Focus previous landmark */
  previousLandmark(): string | null {
    if (this.landmarks.length === 0) {
      this.scanLandmarks();
    }
    if (this.landmarks.length === 0) return null;

    this.currentLandmarkIndex =
      this.currentLandmarkIndex <= 0 ? this.landmarks.length - 1 : this.currentLandmarkIndex - 1;
    const landmark = this.landmarks[this.currentLandmarkIndex];
    if (!landmark) return null;

    this.focusElement(landmark.element);
    return `${landmark.label}, ${landmark.role}`;
  }

  /** Focus a specific element and set tab index if needed */
  focusElement(element: HTMLElement): void {
    if (!element.getAttribute('tabindex')) {
      element.setAttribute('tabindex', '-1');
    }
    element.focus({ preventScroll: false });
  }

  /** Move focus to the first focusable element within a container */
  focusFirstIn(container: HTMLElement | null): boolean {
    if (!container) return false;
    const focusable = container.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable) {
      focusable.focus();
      return true;
    }
    return false;
  }

  /** Get accessible name of currently focused element */
  getFocusedLabel(): string {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return 'No focus';

    return (
      active.getAttribute('aria-label') ??
      active.getAttribute('aria-labelledby') ??
      active.getAttribute('title') ??
      active.getAttribute('placeholder') ??
      active.textContent?.slice(0, 50).trim() ??
      'Unknown element'
    );
  }

  /** Announce text via aria-live region (create if missing) */
  announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    let liveRegion = document.getElementById('voice-live-region');
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.id = 'voice-live-region';
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', priority);
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.className = 'sr-only';
      liveRegion.style.cssText =
        'position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;';
      document.body.appendChild(liveRegion);
    }

    liveRegion.setAttribute('aria-live', priority);
    liveRegion.textContent = '';
    // Small delay to ensure screen reader notices the change
    requestAnimationFrame(() => {
      liveRegion!.textContent = message;
    });
  }
}

export const audioNavigator = new AudioNavigator();
