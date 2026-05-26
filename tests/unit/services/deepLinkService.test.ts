/**
 * Tests for services/deepLinkService.ts
 * QNBS-v3: Pure hash parsing + history.replaceState — no mocks needed for parsing tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHash, pushHash, readCurrentView } from '../../../services/deepLinkService';

describe('deepLinkService', () => {
  describe('parseHash', () => {
    it('returns null view for empty hash', () => {
      expect(parseHash('')).toEqual({ view: null, sectionId: null, action: null });
    });

    it('parses #/dashboard', () => {
      const result = parseHash('#/dashboard');
      expect(result.view).toBe('dashboard');
      expect(result.sectionId).toBeNull();
      expect(result.action).toBeNull();
    });

    it('parses #/manuscript', () => {
      expect(parseHash('#/manuscript').view).toBe('manuscript');
    });

    it('parses #/writer', () => {
      expect(parseHash('#/writer').view).toBe('writer');
    });

    it('parses #/board as sceneboard alias', () => {
      expect(parseHash('#/board').view).toBe('sceneboard');
    });

    it('parses #/plotboard as sceneboard alias', () => {
      expect(parseHash('#/plotboard').view).toBe('sceneboard');
    });

    it('parses section id from #/manuscript/scene/{id}', () => {
      const result = parseHash('#/manuscript/scene/sec-42');
      expect(result.view).toBe('manuscript');
      expect(result.sectionId).toBe('sec-42');
    });

    it('parses action from query string', () => {
      const result = parseHash('#/progress?action=start-session');
      expect(result.view).toBe('progress');
      expect(result.action).toBe('start-session');
    });

    it('returns null for unrecognised view key', () => {
      expect(parseHash('#/unknown').view).toBeNull();
    });

    it('handles hash without leading slash', () => {
      expect(parseHash('#dashboard').view).toBe('dashboard');
    });

    it('parses analytics view', () => {
      expect(parseHash('#/analytics').view).toBe('analytics');
    });

    it('parses zen view', () => {
      expect(parseHash('#/zen').view).toBe('zen');
    });

    it('parses characterGraph view', () => {
      expect(parseHash('#/characterGraph').view).toBe('characterGraph');
    });

    it('parses consistencyChecker view', () => {
      expect(parseHash('#/consistencyChecker').view).toBe('consistencyChecker');
    });
  });

  describe('pushHash', () => {
    let replaceStateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    });

    afterEach(() => {
      replaceStateSpy.mockRestore();
    });

    it('pushes view-only hash', () => {
      pushHash('dashboard');
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#/dashboard');
    });

    it('pushes hash with sectionId', () => {
      pushHash('manuscript', 'sec-1');
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#/manuscript/scene/sec-1');
    });
  });

  describe('readCurrentView', () => {
    it('reads from window.location.hash', () => {
      Object.defineProperty(window, 'location', {
        value: { hash: '#/settings' },
        writable: true,
        configurable: true,
      });
      expect(readCurrentView()).toBe('settings');
    });
  });
});
