/**
 * Tests for services/tauriDeepLink.ts
 * QNBS-v3: Tauri deep link service for native file associations.
 */

import { describe, expect, it } from 'vitest';
import {
  deepLinkUrlToPath,
  getProjectIdFromPath,
  isStoryCraftProjectFile,
} from '../../../services/tauriDeepLink';

describe('tauriDeepLink', () => {
  describe('deepLinkUrlToPath', () => {
    it('strips the new worldscript:// scheme (POSIX absolute path)', () => {
      expect(deepLinkUrlToPath('worldscript:///home/user/my-novel.worldscript')).toBe(
        '/home/user/my-novel.worldscript',
      );
    });

    it('still strips the legacy storycraft:// scheme during migration', () => {
      expect(deepLinkUrlToPath('storycraft:///home/user/my-novel.storycraft')).toBe(
        '/home/user/my-novel.storycraft',
      );
    });

    it('treats the legacy and new schemes identically', () => {
      for (const rest of [':///home/user/a.json', '://C:/Users/me/b.json', ':/srv/c.json']) {
        expect(deepLinkUrlToPath(`worldscript${rest}`)).toBe(
          deepLinkUrlToPath(`storycraft${rest}`),
        );
      }
    });

    it('normalizes Windows drive-letter paths (two-slash and canonical triple-slash forms)', () => {
      // Two-slash form: scheme strip already removes all slashes before the drive letter.
      expect(deepLinkUrlToPath('worldscript://C:/Users/me/novel.worldscript')).toBe(
        'C:/Users/me/novel.worldscript',
      );
      // Canonical triple-slash form (file-URL style) leaves a leading slash (/C:/...) that
      // must still be stripped so Tauri `exists()` resolves the real Windows path.
      expect(deepLinkUrlToPath('worldscript:///C:/Users/me/novel.worldscript')).toBe(
        'C:/Users/me/novel.worldscript',
      );
      expect(deepLinkUrlToPath('storycraft:///D:/Docs/book.storycraft')).toBe(
        'D:/Docs/book.storycraft',
      );
    });

    it('is case-insensitive on the scheme', () => {
      expect(deepLinkUrlToPath('WorldScript:///home/user/file.json')).toBe('/home/user/file.json');
    });

    it('returns non-scheme inputs (raw CLI paths) unchanged', () => {
      expect(deepLinkUrlToPath('/home/user/file.json')).toBe('/home/user/file.json');
      expect(deepLinkUrlToPath('C:/Users/me/file.json')).toBe('C:/Users/me/file.json');
    });
  });

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
