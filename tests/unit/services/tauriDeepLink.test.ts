/**
 * Tests for services/tauriDeepLink.ts
 * QNBS-v3: Tauri deep link service for native file associations.
 */

import { describe, expect, it } from 'vitest';
import { getProjectIdFromPath, isStoryCraftProjectFile } from '../../../services/tauriDeepLink';

describe('tauriDeepLink', () => {
  describe('isStoryCraftProjectFile', () => {
    it('returns true for .storycraft extension', () => {
      expect(isStoryCraftProjectFile('/path/to/project.storycraft')).toBe(true);
    });

    it('returns true for .scst extension', () => {
      expect(isStoryCraftProjectFile('/path/to/project.scst')).toBe(true);
    });

    it('returns true for .json extension', () => {
      expect(isStoryCraftProjectFile('/path/to/project.json')).toBe(true);
    });

    it('returns false for other extensions', () => {
      expect(isStoryCraftProjectFile('/path/to/document.txt')).toBe(false);
      expect(isStoryCraftProjectFile('/path/to/image.png')).toBe(false);
    });

    it('handles mixed case extensions', () => {
      expect(isStoryCraftProjectFile('/path/to/project.STORYCRAFT')).toBe(true);
      expect(isStoryCraftProjectFile('/path/to/project.Scst')).toBe(true);
    });
  });

  describe('getProjectIdFromPath', () => {
    it('extracts project ID from path', () => {
      expect(getProjectIdFromPath('/path/to/my-novel.storycraft')).toBe('my-novel');
    });

    it('extracts project ID from .scst extension', () => {
      expect(getProjectIdFromPath('/path/to/my-novel.scst')).toBe('my-novel');
    });

    it('extracts project ID from .json extension', () => {
      expect(getProjectIdFromPath('/path/to/my-novel.json')).toBe('my-novel');
    });

    it('returns unknown for empty path', () => {
      expect(getProjectIdFromPath('')).toBe('unknown');
    });

    it('handles path without extension', () => {
      expect(getProjectIdFromPath('/path/to/project')).toBe('project');
    });
  });
});
