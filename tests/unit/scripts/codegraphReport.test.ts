// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { redactPaths, sanitize } from '../../../scripts/codegraph-report.mjs';

describe('codegraph-report sanitization', () => {
  describe('sanitize (ANSI stripping)', () => {
    it('strips ANSI color escape codes', () => {
      const colored = '\x1b[32m✓\x1b[0m Indexed 260 files';
      expect(sanitize(colored)).toBe('✓ Indexed 260 files');
    });

    it('strips multiple ANSI sequences in one string', () => {
      const colored = '\x1b[1m\x1b[36mStatus\x1b[0m: \x1b[32mhealthy\x1b[0m';
      expect(sanitize(colored)).toBe('Status: healthy');
    });

    it('leaves plain text untouched', () => {
      expect(sanitize('no color codes here')).toBe('no color codes here');
    });
  });

  describe('redactPaths (absolute-path sanitization)', () => {
    it('redacts the repo root to a relative dot', () => {
      const text = 'Indexed /home/pc/WorldScript-Studio/.worktrees/main/services/foo.ts';
      const redacted = redactPaths(text, {
        root: '/home/pc/WorldScript-Studio/.worktrees/main',
        home: '',
      });
      expect(redacted).toBe('Indexed ./services/foo.ts');
      expect(redacted).not.toContain('/home/pc');
    });

    it('redacts the home directory to ~', () => {
      const text = 'Config at /home/pc/.codegraph/config.json';
      const redacted = redactPaths(text, { root: '', home: '/home/pc' });
      expect(redacted).toBe('Config at ~/.codegraph/config.json');
    });

    it('redacts both root and home when both are present', () => {
      const text = '/home/pc/WorldScript-Studio/.worktrees/main/foo.ts and /home/pc/.cache/x';
      const redacted = redactPaths(text, {
        root: '/home/pc/WorldScript-Studio/.worktrees/main',
        home: '/home/pc',
      });
      expect(redacted).toBe('./foo.ts and ~/.cache/x');
      expect(redacted).not.toContain('/home/pc');
    });
  });

  describe('sanitize (combined ANSI + path pass)', () => {
    it('never leaves an absolute machine path or ANSI code in the sanitized output', () => {
      const raw =
        '\x1b[32m/home/pc/WorldScript-Studio/.worktrees/main/services/foo.ts\x1b[0m indexed';
      const clean = sanitize(raw, {
        root: '/home/pc/WorldScript-Studio/.worktrees/main',
        home: '/home/pc',
      });
      expect(clean).not.toContain('\x1b[');
      expect(clean).not.toContain('/home/pc');
      expect(clean).toBe('./services/foo.ts indexed');
    });
  });
});
