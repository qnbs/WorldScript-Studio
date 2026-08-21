/**
 * Tests for services/tauriDeepLink.ts
 * QNBS-v3: Tauri deep link service for native file associations.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDispatch } from '../../../app/store';
import type { I18nTranslate } from '../../../services/commands/commandTypes';

// QNBS-v3: Wave 1 — mocks services/desktopPlatform's deepLinks/filesystem facets, not @tauri-apps/api/event + plugin-fs directly.
const h = vi.hoisted(() => ({
  isDesktop: { value: true },
  onDeepLink: vi.fn(async (_cb: (urls: string[]) => void | Promise<void>) => () => {}),
  exists: vi.fn(async (_path: string) => true),
  readTextFile: vi.fn(async (_path: string) => '{"title":"Imported"}'),
}));

vi.mock('../../../services/desktopPlatform', () => ({
  get desktopPlatform() {
    return {
      runtime: {
        get isDesktop() {
          return h.isDesktop.value;
        },
        os: null,
      },
      deepLinks: { onDeepLink: (cb: (urls: string[]) => void | Promise<void>) => h.onDeepLink(cb) },
      filesystem: {
        exists: (p: string) => h.exists(p),
        readTextFile: (p: string) => h.readTextFile(p),
      },
    };
  },
}));

vi.mock('../../../features/project/thunks/projectManagementThunks', () => ({
  importProjectThunk: Object.assign(
    vi.fn(() => ({ type: 'project/importProject/pending' })),
    {
      fulfilled: { match: (action: { type: string }) => action.type.endsWith('/fulfilled') },
    },
  ),
}));

import {
  deepLinkUrlToPath,
  getProjectIdFromPath,
  initTauriDeepLink,
  isLegacyStorycraftDeepLink,
  isWorldScriptProjectFile,
} from '../../../services/tauriDeepLink';

describe('tauriDeepLink', () => {
  describe('deepLinkUrlToPath', () => {
    it('strips the new worldscript:// scheme (POSIX absolute path)', () => {
      expect(deepLinkUrlToPath('worldscript:///home/user/my-novel.worldscript')).toBe(
        '/home/user/my-novel.worldscript',
      );
    });

    // QNBS-v3: retain coverage for the one-release legacy deep-link migration notice.
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

  describe('isLegacyStorycraftDeepLink', () => {
    it('identifies the compatibility scheme without matching worldscript links', () => {
      expect(isLegacyStorycraftDeepLink('storycraft:///home/user/file.json')).toBe(true);
      expect(isLegacyStorycraftDeepLink('StoryCraft://C:/file.json')).toBe(true);
      expect(isLegacyStorycraftDeepLink('worldscript:///home/user/file.json')).toBe(false);
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

  describe('initTauriDeepLink', () => {
    const dispatchMock = vi.fn((action: unknown) => action);
    const dispatch = dispatchMock as unknown as AppDispatch;
    const t = ((key: string) => {
      if (key === 'error.deepLink.legacyTitle') return 'Legacy deep link scheme';
      if (key === 'error.deepLink.legacyDescription') {
        return 'storycraft:// links are deprecated; recreate the link with worldscript://.';
      }
      return key;
    }) as I18nTranslate;

    beforeEach(() => {
      dispatchMock.mockClear();
      h.isDesktop.value = true;
      h.onDeepLink.mockClear();
      h.exists.mockReset().mockResolvedValue(true);
      h.readTextFile.mockReset().mockResolvedValue('{"title":"Imported"}');
    });

    it('returns a no-op cleanup on the web without subscribing', async () => {
      h.isDesktop.value = false;
      const cleanup = await initTauriDeepLink(dispatch, t);
      expect(h.onDeepLink).not.toHaveBeenCalled();
      expect(() => cleanup()).not.toThrow();
    });

    it('imports the file and navigates on a fulfilled import', async () => {
      await initTauriDeepLink(dispatch, t);
      const handler = h.onDeepLink.mock.calls[0]?.[0] as (urls: string[]) => Promise<void>;
      dispatchMock.mockReturnValueOnce({ type: 'project/importProject/fulfilled' });
      await handler(['worldscript:///home/user/novel.worldscript']);
      expect(h.exists).toHaveBeenCalledWith('/home/user/novel.worldscript');
      expect(h.readTextFile).toHaveBeenCalledWith('/home/user/novel.worldscript');
    });

    it('announces the legacy scheme during the one-release compatibility window', async () => {
      await initTauriDeepLink(dispatch, t);
      const handler = h.onDeepLink.mock.calls[0]?.[0] as (urls: string[]) => Promise<void>;
      dispatchMock.mockReturnValueOnce(undefined).mockReturnValueOnce({
        type: 'project/importProject/fulfilled',
      });
      await handler(['storycraft:///home/user/novel.worldscript']);
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status/addNotification',
          payload: expect.objectContaining({
            type: 'info',
            title: 'Legacy deep link scheme',
            description: expect.stringContaining('worldscript://'),
          }),
        }),
      );
      expect(dispatchMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status/addNotification',
          payload: expect.objectContaining({ type: 'error' }),
        }),
      );
    });

    it('dispatches an error notification when the file does not exist', async () => {
      h.exists.mockResolvedValue(false);
      await initTauriDeepLink(dispatch, t);
      const handler = h.onDeepLink.mock.calls[0]?.[0] as (urls: string[]) => Promise<void>;
      await handler(['worldscript:///missing.worldscript']);
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status/addNotification',
          payload: expect.objectContaining({ type: 'error' }),
        }),
      );
    });

    it('skips empty URLs in the payload without throwing', async () => {
      await initTauriDeepLink(dispatch, t);
      const handler = h.onDeepLink.mock.calls[0]?.[0] as (urls: string[]) => Promise<void>;
      await expect(handler([''])).resolves.toBeUndefined();
      expect(h.exists).not.toHaveBeenCalled();
    });
  });
});
