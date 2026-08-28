// @vitest-environment node

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
// QNBS-v3: focused tests protect committed-report privacy, freshness, and strict orchestration.
import { redactPaths, sanitize, validateIndexStatus } from '../../../scripts/codegraph-report.mjs';

const require = createRequire(import.meta.url);
const graphsCli = require('../../../scripts/graphs-cli.mjs') as {
  isSupportedCommand: (command: string, availableCommands: object) => boolean;
  strictRefreshFailure: (outcome: {
    updateStatus: number;
    reportStatus: number;
    reportsFresh: boolean;
  }) => string | null;
};

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

    it('strips non-color CSI and OSC control sequences', () => {
      expect(sanitize('before\x1b[2Kafter\x1b]0;secret title\x07done')).toBe('beforeafterdone');
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

    it('does not redact an unrelated substring that only contains the root text', () => {
      const root = '/home/pc/WorldScript-Studio/.worktrees/main';
      expect(redactPaths(`x${root}ish ${root}/src/index.ts`, { root, home: '' })).toBe(
        `x${root}ish ./src/index.ts`,
      );
    });

    it('redacts Windows roots with either separator at a path boundary', () => {
      expect(
        redactPaths('C:\\Work\\World\\src C:\\Work\\Worldish', {
          root: 'C:\\Work\\World',
          home: '',
        }),
      ).toBe('.\\src C:\\Work\\Worldish');
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

  describe('CodeGraph machine-readable freshness contract', () => {
    const current = {
      initialized: true,
      version: '1.6.0',
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      worktreeMismatch: null,
      index: { builtWithVersion: '1.6.0', reindexRecommended: false },
    };

    it('accepts a current structured status', () => {
      expect(validateIndexStatus(current, '1.6.0')).toBe(current);
    });

    it.each([
      ['pending sync', { ...current, pendingChanges: { added: 1, modified: 0, removed: 0 } }],
      ['worktree mismatch', { ...current, worktreeMismatch: 'changed' }],
      ['reindex required', { ...current, index: { ...current.index, reindexRecommended: true } }],
      ['version mismatch', { ...current, version: '1.1.3' }],
    ])('rejects %s before report output can be accepted', (_label, status) => {
      expect(() => validateIndexStatus(status, '1.6.0')).toThrow();
    });
  });

  describe('strict orchestration contracts', () => {
    it('rejects inherited command names', () => {
      expect(graphsCli.isSupportedCommand('toString', { refresh: true })).toBe(false);
      expect(graphsCli.isSupportedCommand('refresh', { refresh: true })).toBe(true);
    });

    it.each([
      ['missing Graphify', { updateStatus: 1, reportStatus: 0, reportsFresh: true }],
      ['missing CodeGraph', { updateStatus: 0, reportStatus: 1, reportsFresh: true }],
      ['stale reports', { updateStatus: 0, reportStatus: 0, reportsFresh: false }],
    ])('never reports strict refresh success for %s', (_label, outcome) => {
      expect(graphsCli.strictRefreshFailure(outcome)).toBeTruthy();
    });

    it('accepts strict refresh only after the final freshness postcondition', () => {
      expect(
        graphsCli.strictRefreshFailure({ updateStatus: 0, reportStatus: 0, reportsFresh: true }),
      ).toBeNull();
    });
  });
});
