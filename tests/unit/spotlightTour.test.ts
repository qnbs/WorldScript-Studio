import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — driver.js is a DOM/animation library not available in jsdom
// ---------------------------------------------------------------------------

const mockDriverStart = vi.fn();
const mockDriverDestroy = vi.fn();
const mockDriverInstance = {
  drive: mockDriverStart,
  destroy: mockDriverDestroy,
};

vi.mock('driver.js', () => ({
  driver: vi.fn(() => mockDriverInstance),
}));

vi.mock('driver.js/dist/driver.css', () => ({}));

import {
  hasCompletedSpotlightTour,
  markSpotlightTourComplete,
  SPOTLIGHT_TOUR_STORAGE_KEY,
  startSpotlightTour,
} from '../../services/spotlightTour';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

describe('markSpotlightTourComplete', () => {
  it('sets the done flag in localStorage', () => {
    markSpotlightTourComplete();
    expect(localStorage.getItem(SPOTLIGHT_TOUR_STORAGE_KEY)).toBe('1');
  });
});

describe('hasCompletedSpotlightTour', () => {
  it('returns false when not set', () => {
    expect(hasCompletedSpotlightTour()).toBe(false);
  });

  it('returns true after markSpotlightTourComplete()', () => {
    markSpotlightTourComplete();
    expect(hasCompletedSpotlightTour()).toBe(true);
  });

  it('returns false when value is not "1"', () => {
    localStorage.setItem(SPOTLIGHT_TOUR_STORAGE_KEY, '0');
    expect(hasCompletedSpotlightTour()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startSpotlightTour
// ---------------------------------------------------------------------------

describe('startSpotlightTour', () => {
  const t = (k: string) => k;

  it('calls driver().drive() for the default tour', () => {
    startSpotlightTour(t, 'default');
    expect(mockDriverStart).toHaveBeenCalled();
  });

  it('calls driver().drive() for the navigation tour', () => {
    startSpotlightTour(t, 'navigation');
    expect(mockDriverStart).toHaveBeenCalled();
  });

  it('calls driver().drive() when tourId is omitted', () => {
    startSpotlightTour(t);
    expect(mockDriverStart).toHaveBeenCalled();
  });
});
