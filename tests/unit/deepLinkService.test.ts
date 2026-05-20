import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHash, pushHash, readCurrentView } from '../../services/deepLinkService';

describe('deepLinkService', () => {
  describe('parseHash', () => {
    it('parses a simple view hash', () => {
      const result = parseHash('#/dashboard');
      expect(result).toEqual({ view: 'dashboard', sectionId: null, action: null });
    });

    it('maps the board alias to sceneboard', () => {
      const result = parseHash('#/board');
      expect(result).toEqual({ view: 'sceneboard', sectionId: null, action: null });
    });

    it('parses preview view', () => {
      const result = parseHash('#/preview');
      expect(result).toEqual({ view: 'preview', sectionId: null, action: null });
    });

    it('parses progress view', () => {
      const result = parseHash('#/progress');
      expect(result).toEqual({ view: 'progress', sectionId: null, action: null });
    });

    it('parses hash with action query param', () => {
      const result = parseHash('#/progress?action=start-session');
      expect(result).toEqual({ view: 'progress', sectionId: null, action: 'start-session' });
    });

    it('parses manuscript/scene/sectionId deep link', () => {
      const result = parseHash('#/manuscript/scene/abc-123');
      expect(result).toEqual({ view: 'manuscript', sectionId: 'abc-123', action: null });
    });

    it('ignores scene segment when no sectionId follows', () => {
      const result = parseHash('#/manuscript/scene');
      expect(result).toEqual({ view: 'manuscript', sectionId: null, action: null });
    });

    it('returns null view for unknown hash', () => {
      const result = parseHash('#/unknown-route');
      expect(result).toEqual({ view: null, sectionId: null, action: null });
    });

    it('handles empty hash', () => {
      const result = parseHash('#');
      expect(result).toEqual({ view: null, sectionId: null, action: null });
    });

    it('handles hash without leading slash', () => {
      const result = parseHash('#writer');
      expect(result).toEqual({ view: 'writer', sectionId: null, action: null });
    });

    it('handles completely empty string', () => {
      const result = parseHash('');
      expect(result).toEqual({ view: null, sectionId: null, action: null });
    });

    it('parses all known view routes', () => {
      const routes: Array<[string, string]> = [
        ['dashboard', 'dashboard'],
        ['manuscript', 'manuscript'],
        ['writer', 'writer'],
        ['templates', 'templates'],
        ['outline', 'outline'],
        ['characters', 'characters'],
        ['world', 'world'],
        ['export', 'export'],
        ['settings', 'settings'],
        ['help', 'help'],
        ['sceneboard', 'sceneboard'],
        ['characterGraph', 'characterGraph'],
        ['consistencyChecker', 'consistencyChecker'],
        ['critic', 'critic'],
        ['preview', 'preview'],
        ['progress', 'progress'],
        ['analytics', 'analytics'],
        ['zen', 'zen'],
      ];
      for (const [hash, view] of routes) {
        expect(parseHash(`#/${hash}`).view).toBe(view);
      }
    });

    it('maps plotboard alias to sceneboard', () => {
      expect(parseHash('#/plotboard').view).toBe('sceneboard');
    });

    it('maps analytics to analytics', () => {
      expect(parseHash('#/analytics').view).toBe('analytics');
    });

    it('maps zen to zen', () => {
      expect(parseHash('#/zen').view).toBe('zen');
    });

    it('falls back to window.location.hash when called with no argument', () => {
      Object.defineProperty(window, 'location', {
        value: { hash: '#/settings' },
        configurable: true,
      });
      const result = parseHash();
      expect(result.view).toBe('settings');
    });
  });

  describe('pushHash', () => {
    let replaceSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      replaceSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    });

    it('writes the view to the URL hash', () => {
      pushHash('dashboard');
      expect(replaceSpy).toHaveBeenCalledWith(null, '', '#/dashboard');
    });

    it('includes sectionId in the path when provided', () => {
      pushHash('manuscript', 'section-42');
      expect(replaceSpy).toHaveBeenCalledWith(null, '', '#/manuscript/scene/section-42');
    });

    it('omits sectionId segment when undefined', () => {
      pushHash('progress');
      expect(replaceSpy).toHaveBeenCalledWith(null, '', '#/progress');
    });
  });

  describe('readCurrentView', () => {
    it('returns the view from window.location.hash', () => {
      Object.defineProperty(window, 'location', {
        value: { hash: '#/outline' },
        configurable: true,
      });
      expect(readCurrentView()).toBe('outline');
    });

    it('returns null for unrecognised hash', () => {
      Object.defineProperty(window, 'location', {
        value: { hash: '#/nope' },
        configurable: true,
      });
      expect(readCurrentView()).toBeNull();
    });
  });
});
