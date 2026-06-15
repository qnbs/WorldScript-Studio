/**
 * Tests for services/tauriDeepLink.ts
 * QNBS-v3: Tauri deep link service for native file associations.
 */

import { describe, expect, it } from 'vitest';
import { getProjectIdFromPath, isWorldScriptProjectFile } from '../../../services/tauriDeepLink';

describe('tauriDeepLink', () => {
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
      // QNBS-v3: .json must also be case-insensitive (was a case-sensitive endsWith).
      expect(isWorldScriptProjectFile('/path/to/project.JSON')).toBe(true);
      expect(isWorldScriptProjectFile('/path/to/project.Json')).toBe(true);
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

    it('strips uppercase extensions (case-insensitive)', () => {
      expect(getProjectIdFromPath('/path/to/my-novel.WORLDSCRIPT')).toBe('my-novel');
      expect(getProjectIdFromPath('/path/to/my-novel.WSST')).toBe('my-novel');
      expect(getProjectIdFromPath('/path/to/my-novel.JSON')).toBe('my-novel');
    });
  });
});
