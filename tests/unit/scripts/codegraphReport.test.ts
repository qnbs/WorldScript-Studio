// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// QNBS-v3: focused tests protect committed-report privacy, freshness, and strict orchestration.
import { redactPaths, sanitize, validateIndexStatus } from '../../../scripts/codegraph-report.mjs';
import { matchesExactVersion } from '../../../scripts/graphSourceFingerprint.mjs';

const graphsCliModulePath = ['..', '..', '..', 'scripts', 'graphs-cli.mjs'].join('/');
const graphsCli = (await import(graphsCliModulePath)) as unknown as {
  isSupportedCommand: (command: string, availableCommands: object) => boolean;
  strictRefreshFailure: (outcome: {
    updateStatus: number;
    reportStatus: number;
    reportsFresh: boolean;
  }) => string | null;
  reportFreshness: (
    meta: {
      exists: boolean;
      schema: string;
      toolVersion: string;
      fingerprint: string;
      tool: string;
      text: string;
    },
    policy: { reportSchemaVersion: number; expectedVersion: string },
    fingerprint: string,
  ) => string;
};
const graphifyReport = (await import(
  ['..', '..', '..', 'scripts', 'graphify-report.mjs'].join('/')
)) as {
  recoverOrphanedCompactReport: (reportPath: string, backupPath: string) => boolean;
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

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

    it('strips OSC sequences terminated by ST', () => {
      expect(sanitize('before\x1b]0;secret title\x1b\\after')).toBe('beforeafter');
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

  it('rejects metadata-only or truncated reports with otherwise current metadata', () => {
    const metadata = {
      exists: true,
      schema: '1',
      toolVersion: '1.6.0',
      fingerprint: 'sha256:current',
      tool: 'codegraph',
      text: '# CodeGraph Report\n\nReport schema: 1\nSource fingerprint: sha256:current',
    };
    expect(
      graphsCli.reportFreshness(
        metadata,
        { reportSchemaVersion: 1, expectedVersion: '1.6.0' },
        'sha256:current',
      ),
    ).toBe('REPORT_INVALID');
  });

  it('accepts an intact generated CodeGraph report as fresh', () => {
    const report =
      '# CodeGraph Report\n\nReport schema: 1\nSource fingerprint: sha256:current\n' +
      'Tool: codegraph\nTool version: 1.6.0\nGeneration mode: test\n\n' +
      '## Status\n\n```text\nInitialized: yes\n```\n\n## Files by Extension\n\n- **.mjs**: 1\n\n' +
      '---\n\n*Regenerate with: `pnpm run graphs:report`*';
    expect(
      graphsCli.reportFreshness(
        {
          exists: true,
          schema: '1',
          toolVersion: '1.6.0',
          fingerprint: 'sha256:current',
          tool: 'codegraph',
          text: report,
        },
        { reportSchemaVersion: 1, expectedVersion: '1.6.0' },
        'sha256:current',
      ),
    ).toBe('FRESH');
  });

  it('keeps stale classification ahead of body validation', () => {
    expect(
      graphsCli.reportFreshness(
        {
          exists: true,
          schema: '1',
          toolVersion: '1.6.0',
          fingerprint: 'sha256:old',
          tool: 'codegraph',
          text: 'truncated',
        },
        { reportSchemaVersion: 1, expectedVersion: '1.6.0' },
        'sha256:current',
      ),
    ).toBe('STALE');
  });

  it('shares exact version matching semantics with graph tooling', () => {
    expect(matchesExactVersion('codegraph 1.6.0', '1.6.0')).toBe(true);
    expect(matchesExactVersion('codegraph 1.6.01', '1.6.0')).toBe(false);
    expect(matchesExactVersion('codegraph 1.6.0-rc.1', '1.6.0')).toBe(false);
    expect(matchesExactVersion('codegraph 1.6.0.1', '1.6.0')).toBe(false);
  });

  it('recovers a valid orphaned Graphify compact report before a new transaction', () => {
    const directory = mkdtempSync(join(tmpdir(), 'graphify-report-test-'));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, 'GRAPH_REPORT.md');
    const backupPath = `${reportPath}.previous-compact`;
    const previous =
      '# Graph Report - project\n\nReport schema: 1\nSource fingerprint: sha256:' +
      'a'.repeat(64) +
      '\nTool: graphify\nTool version: 0.9.51\nGeneration mode: test\n\n' +
      '## Summary\n- valid\n\n## Top 1 Communities by size (of 1 total)\n\n' +
      '## Knowledge Gaps\n- none\n';
    writeFileSync(backupPath, previous);
    expect(graphifyReport.recoverOrphanedCompactReport(reportPath, backupPath)).toBe(true);
    expect(readFileSync(reportPath, 'utf-8')).toBe(previous);
    expect(existsSync(backupPath)).toBe(false);
  });

  it('recovers a valid compact backup over an interrupted native primary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'graphify-report-test-'));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, 'GRAPH_REPORT.md');
    const backupPath = `${reportPath}.previous-compact`;
    const previous =
      '# Graph Report - project\n\nReport schema: 1\nSource fingerprint: sha256:' +
      'b'.repeat(64) +
      '\nTool: graphify\nTool version: 0.9.51\nGeneration mode: test\n\n' +
      '## Summary\n- valid\n\n## Top 1 Communities by size (of 1 total)\n\n' +
      '## Knowledge Gaps\n- none\n';
    writeFileSync(reportPath, '# Native Graphify output\n## Communities (1 total)\n');
    writeFileSync(backupPath, previous);
    expect(graphifyReport.recoverOrphanedCompactReport(reportPath, backupPath)).toBe(true);
    expect(readFileSync(reportPath, 'utf-8')).toBe(previous);
    expect(existsSync(backupPath)).toBe(false);
  });
});
