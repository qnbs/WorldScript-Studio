/**
 * Tests for services/tauriDeepLink.ts
 * QNBS-v3: Tauri deep link service for native file associations.
 */

import { describe, expect, it } from 'vitest';
import {
  deepLinkUrlToPath,
  getProjectIdFromPath,
  isWorldScriptProjectFile,
} from '../../../services/tauriDeepLink';

describe('tauriDeepLink', () => {
  describe('deepLinkUrlToPath', () => {
    it('strips the new worldscript:// scheme (POSIX absolute path)', () => {
      expect(deepLinkUrlToPath('worldscript:///home/user/my-novel.worldscript')).toBe(
        '/home/user/my-novel.worldscript',
      );
    });

    it('still strips the legacy storycraft:// scheme during migration', () => {
      expect(deepLinkUrlToPath('storycraft:///home/user/my-novel.worldscript')).toBe(
        '/home/user/my-novel.worldscript',
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
      expect(deepLinkUrlToPath('storycraft:///D:/Docs/book.worldscript')).toBe(
        'D:/Docs/book.worldscript',
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

  describe('isWorldScriptProjectFile', () => {
    it('returns true for .worldscript extension', () => {
      expect(isWorldScriptProjectFile('/path/to/project.worldscript')).toBe(true);
    });

    it('returns true for .wsst extension', () => {
      expect(isWorldScriptProjectFile('/path/to/project.wsst')).toBe(true);
    });

    it('returns true for .json extension', () => {
      expect(isWorldScriptProjectFile('/path/to/project.json')).toBe(true);
    });

    it('returns false for other extensions', () => {
      expect(isWorldScriptProjectFile('/path/to/document.txt')).toBe(false);
      expect(isWorldScriptProjectFile('/path/to/image.png')).toBe(false);
    });

    it('handles mixed case extensions', () => {
      expect(isWorldScriptProjectFile('/path/to/project.WORLDSCRIPT')).toBe(true);
      expect(isWorldScriptProjectFile('/path/to/project.Wsst')).toBe(true);
    });
  });

  describe('getProjectIdFromPath', () => {
    it('extracts project ID from path', () => {
      expect(getProjectIdFromPath('/path/to/my-novel.worldscript')).toBe('my-novel');
    });

    it('extracts project ID from .wsst extension', () => {
      expect(getProjectIdFromPath('/path/to/my-novel.wsst')).toBe('my-novel');
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
