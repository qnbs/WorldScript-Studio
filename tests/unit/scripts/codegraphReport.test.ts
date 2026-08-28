// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// QNBS-v3: focused tests protect committed-report privacy, freshness, and strict orchestration.
import {
  formatExtensionLines,
  redactPaths,
  sanitize,
  validateFileList,
  validateIndexStatus,
} from '../../../scripts/codegraph-report.mjs';
import { ROOT } from '../../../scripts/graphSourceFingerprint.mjs';

const graphsCliModulePath = ['..', '..', '..', 'scripts', 'graphs-cli.mjs'].join('/');
const graphsCli = (await import(graphsCliModulePath)) as unknown as {
  isSupportedCommand: (command: string, availableCommands: object) => boolean;
  strictRefreshFailure: (outcome: {
    updateStatus: number;
    reportStatus: number;
    reportsFresh: boolean;
  }) => string | null;
  versionProbeStatus: (result: {
    status: number | null;
    stdout?: string;
    stderr?: string;
    error?: { code?: string };
  }) => string;
  shouldSkipGraphifyUpdate: (args: string[], env?: NodeJS.ProcessEnv) => boolean;
  prepareGraphifyReportBackup: (reportPath?: string, backupPath?: string) => boolean;
  cleanupGraphifyEphemeralOutputs: (outputDir?: string) => void;
  restoreGraphifyReportBackup: (
    hadReport: boolean,
    reportPath?: string,
    backupPath?: string,
  ) => void;
  reportFreshness: (
    meta: {
      exists: boolean;
      schema: string;
      toolVersion: string;
      fingerprint: string;
      tool: string;
      text: string;
    },
    policy: { reportSchemaVersion: number; expectedVersion: string; expectedTool: string },
    fingerprint: string,
  ) => string;
};
const graphifyReport = (await import(
  ['..', '..', '..', 'scripts', 'graphify-report.mjs'].join('/')
)) as {
  recoverOrphanedCompactReport: (reportPath: string, backupPath: string) => boolean;
  validateNativeGraphifyReport: (markdown: string) => boolean;
};
const graphifyBootstrap = (await import(
  ['..', '..', '..', 'scripts', 'graphify-bootstrap.mjs'].join('/')
)) as unknown as { graphifyVersionCommand: (tool: string) => string[] };

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

type ReportMetadata = Parameters<typeof graphsCli.reportFreshness>[0];
const policy = { reportSchemaVersion: 1 };
const reportMetadata = (
  tool: string,
  toolVersion: string,
  text: string,
  fingerprint = 'sha256:current',
): ReportMetadata => ({ exists: true, schema: '1', toolVersion, fingerprint, tool, text });
const reportFreshness = (
  metadata: ReportMetadata,
  expectedVersion: string,
  fingerprint = 'sha256:current',
  expectedTool = metadata.tool,
) => graphsCli.reportFreshness(metadata, { ...policy, expectedVersion, expectedTool }, fingerprint);

describe('codegraph-report sanitization', () => {
  it('counts prototype-named extensions without reading inherited properties', () => {
    expect(formatExtensionLines([{ path: 'one.constructor' }, { path: 'two.constructor' }])).toBe(
      '- **.constructor**: 2',
    );
  });

  describe('sanitize (ANSI stripping)', () => {
    it.each([
      ['color', '\x1b[32m✓\x1b[0m Indexed 260 files', '✓ Indexed 260 files'],
      [
        'multiple colors',
        '\x1b[1m\x1b[36mStatus\x1b[0m: \x1b[32mhealthy\x1b[0m',
        'Status: healthy',
      ],
      ['plain text', 'no color codes here', 'no color codes here'],
      ['non-color CSI and OSC', 'before\x1b[2Kafter\x1b]0;secret title\x07done', 'beforeafterdone'],
      ['OSC terminated by ST', 'before\x1b]0;secret title\x1b\\after', 'beforeafter'],
    ])('sanitizes %s', (_label, input, expected) => expect(sanitize(input)).toBe(expected));
  });

  describe('redactPaths (absolute-path sanitization)', () => {
    it.each([
      [
        'repo root',
        'Indexed /home/pc/WorldScript-Studio/.worktrees/main/services/foo.ts',
        { root: '/home/pc/WorldScript-Studio/.worktrees/main', home: '' },
        'Indexed ./services/foo.ts',
      ],
      [
        'home directory',
        'Config at /home/pc/.codegraph/config.json',
        { root: '', home: '/home/pc' },
        'Config at ~/.codegraph/config.json',
      ],
      [
        'root and home',
        '/home/pc/WorldScript-Studio/.worktrees/main/foo.ts and /home/pc/.cache/x',
        { root: '/home/pc/WorldScript-Studio/.worktrees/main', home: '/home/pc' },
        './foo.ts and ~/.cache/x',
      ],
      [
        'unrelated substring',
        'x/home/pc/WorldScript-Studio/.worktrees/mainish /home/pc/WorldScript-Studio/.worktrees/main/src/index.ts',
        { root: '/home/pc/WorldScript-Studio/.worktrees/main', home: '' },
        'x/home/pc/WorldScript-Studio/.worktrees/mainish ./src/index.ts',
      ],
      [
        'Windows root',
        'C:\\Work\\World\\src C:\\Work\\Worldish',
        { root: 'C:\\Work\\World', home: '' },
        '.\\src C:\\Work\\Worldish',
      ],
      [
        'UNC root',
        '\\\\server\\share\\repo\\src\\a.ts',
        { root: '\\\\SERVER\\Share\\Repo', home: '' },
        '.\\src\\a.ts',
      ],
    ])('redacts %s at a path boundary', (_label, input, options, expected) => {
      expect(redactPaths(input, options)).toBe(expected);
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

  // QNBS-v3: freshness tests keep source, index, metadata, and report structure aligned.
  describe('CodeGraph machine-readable freshness contract', () => {
    const current = {
      initialized: true,
      version: '1.6.0',
      fileCount: 1,
      nodeCount: 2,
      edgeCount: 3,
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
      ['decorated status version', { ...current, version: 'v1.6.0' }],
      [
        'decorated index version',
        { ...current, index: { ...current.index, builtWithVersion: 'v1.6.0' } },
      ],
    ])('rejects %s before report output can be accepted', (_label, status) => {
      expect(() => validateIndexStatus(status, '1.6.0')).toThrow();
    });

    it('rejects a status payload without complete report counts', () => {
      expect(() => validateIndexStatus({ ...current, edgeCount: undefined }, '1.6.0')).toThrow(
        /counts are required/,
      );
    });

    it.each([
      ['truncated', [{ path: 'a.ts' }]],
      ['duplicate', [{ path: 'a.ts' }, { path: 'a.ts' }]],
    ])('rejects %s CodeGraph file evidence', (_label, fileList) => {
      expect(() => validateFileList(fileList, 2)).toThrow(/count/);
    });

    it.each([
      ['empty', {}],
      ['partial', { added: 0, modified: 0 }],
    ])('rejects %s pending-change counters', (_label, pendingChanges) => {
      expect(() => validateIndexStatus({ ...current, pendingChanges }, '1.6.0')).toThrow(/stale/);
    });

    it('rejects filename-derived extensions containing control characters', () => {
      expect(() => formatExtensionLines([{ path: 'a.ts\n## Injected' }])).toThrow(/unsafe/);
    });

    it('escapes Markdown punctuation in filename-derived extensions', () => {
      expect(formatExtensionLines([{ path: 'a.t*s' }])).toBe('- **.t\\*s**: 1');
    });
  });

  describe('strict orchestration contracts', () => {
    it('preserves the direct Graphify update skip contract', () => {
      expect(graphsCli.shouldSkipGraphifyUpdate(['update', '.'], { GRAPHIFY_SKIP: '1' })).toBe(
        true,
      );
      expect(graphsCli.shouldSkipGraphifyUpdate(['update', '.'], {})).toBe(false);
      expect(graphsCli.shouldSkipGraphifyUpdate(['--version'], { GRAPHIFY_SKIP: '1' })).toBe(false);
    });

    it('routes Graphify hook commands through the verified launcher', () => {
      const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
        scripts: Record<string, string>;
      };
      expect(packageJson.scripts['graphify:hooks']).toBe(
        'node scripts/graphs-cli.mjs graphify hook install',
      );
      expect(packageJson.scripts['graphify:status']).toBe(
        'node scripts/graphs-cli.mjs graphify hook status',
      );
    });

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

  it('distinguishes unavailable and broken installed tool probes', () => {
    expect(graphsCli.versionProbeStatus({ status: null, error: { code: 'ENOENT' } })).toBe(
      'SKIPPED_NOT_INSTALLED',
    );
    expect(graphsCli.versionProbeStatus({ status: 1, stderr: 'runtime failed' })).toBe('FAIL');
    expect(graphsCli.versionProbeStatus({ status: 0, stdout: 'graphify 0.9.51' })).toBe(
      'AVAILABLE',
    );
  });

  it('cleans Graphify sidecars around the routed runtime update', () => {
    const directory = mkdtempSync(join(tmpdir(), 'graphs-ephemeral-test-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'manifest.json'), 'stale');
    writeFileSync(join(directory, 'cost.json'), 'stale');
    for (const name of ['transcripts', 'wiki', 'obsidian']) {
      mkdirSync(join(directory, name));
    }

    graphsCli.cleanupGraphifyEphemeralOutputs(directory);

    for (const name of ['manifest.json', 'cost.json', 'transcripts', 'wiki', 'obsidian']) {
      expect(existsSync(join(directory, name))).toBe(false);
    }
  });

  // QNBS-v3: structural fixtures prevent metadata-only corruption from being reported fresh.
  it('rejects metadata-only or truncated reports with otherwise current metadata', () => {
    expect(
      reportFreshness(
        reportMetadata(
          'codegraph',
          '1.6.0',
          '# CodeGraph Report\n\nReport schema: 1\nSource fingerprint: sha256:current',
        ),
        '1.6.0',
      ),
    ).toBe('REPORT_INVALID');
  });

  it('accepts an intact generated CodeGraph report as fresh', () => {
    const report =
      '# CodeGraph Report\n\nReport schema: 1\nSource fingerprint: sha256:current\n' +
      'Tool: codegraph\nTool version: 1.6.0\nGeneration mode: test\n\n' +
      '## Status\n\n```text\nInitialized: yes\nVersion: 1.6.0\nFiles: 1\nNodes: 2\nEdges: 3\n' +
      'Pending changes: {"added":0,"modified":0,"removed":0}\n' +
      'Worktree mismatch: none\nIndex built with: 1.6.0\nReindex required: no\n```\n\n' +
      '## Files by Extension\n\n- **.mjs**: 1\n\n' +
      '---\n\n*Regenerate with: `pnpm run graphs:report`*';
    expect(reportFreshness(reportMetadata('codegraph', '1.6.0', report), '1.6.0')).toBe('FRESH');
  });

  it('rejects CodeGraph reports with heading-only status', () => {
    const report =
      '# CodeGraph Report\n\nReport schema: 1\nSource fingerprint: sha256:current\n' +
      'Tool: codegraph\nTool version: 1.6.0\nGeneration mode: test\n\n' +
      '## Status\n\n```text\nInitialized: yes\n```\n\n## Files by Extension\n\n' +
      '- **.mjs**: 1\n\n---\n\n*Regenerate with: `pnpm run graphs:report`*';
    expect(reportFreshness(reportMetadata('codegraph', '1.6.0', report), '1.6.0')).toBe(
      'REPORT_INVALID',
    );
  });

  it('keeps stale classification ahead of body validation', () => {
    expect(
      reportFreshness(reportMetadata('codegraph', '1.6.0', 'truncated', 'sha256:old'), '1.6.0'),
    ).toBe('STALE');
  });

  it('preserves Graphify freshness checks and rejects cross-tool reports', () => {
    const report =
      '# Graph Report - project\n\nReport schema: 1\nSource fingerprint: sha256:current\n' +
      'Tool: graphify\nTool version: 0.9.51\nGeneration mode: test\n\n' +
      '## Summary\n- valid\n\n## Top 1 Communities by size (of 1 total)\n';
    const mismatchMetadata = reportMetadata('graphify', '1.6.0', report);
    const truncatedReport = report.replace('\n\n## Summary\n- valid\n', '');
    const truncatedMetadata = reportMetadata('graphify', '0.9.51', truncatedReport);
    expect([
      reportFreshness(reportMetadata('graphify', '0.9.51', report), '0.9.51'),
      reportFreshness(truncatedMetadata, '0.9.51'),
      reportFreshness(mismatchMetadata, '1.6.0', 'sha256:current', 'codegraph'),
    ]).toEqual(['FRESH', 'REPORT_INVALID', 'REPORT_INVALID']);
  });

  it.each([
    [
      'missing communities',
      '# Graph Report - project\n\n## Summary\n- partial\n\n## Knowledge Gaps\n- none\n',
      false,
    ],
    [
      'complete empty communities',
      '# Graph Report - project\n\n## Summary\n- none\n\n## Knowledge Gaps\n- none\n\n## Communities (0 total)\n',
      true,
    ],
    [
      'missing knowledge gaps',
      '# Graph Report - project\n\n## Summary\n- none\n\n## Communities (0 total)\n',
      true,
    ],
    [
      'incomplete declared count',
      '# Graph Report - project\n\n## Summary\n- none\n\n## Knowledge Gaps\n- none\n\n## Community Hubs (Navigation)\n- Community 1\n- Community 2\n\n## Communities (3 total, 1 thin omitted)\n',
      false,
    ],
    [
      'complete declared count',
      '# Graph Report - project\n\n## Summary\n- none\n\n## Community Hubs (Navigation)\n- Community 1\n- Community 2\n\n## Communities (3 total, 1 thin omitted)\n\n### Community 1\n',
      true,
    ],
  ])('validates native Graphify output: %s', (_label, markdown, expected) => {
    expect(graphifyReport.validateNativeGraphifyReport(markdown)).toBe(expected);
  });

  it.each([
    ['python', ['-m', 'graphify', '--version']],
    ['python3', ['-m', 'graphify', '--version']],
    ['py', ['-3', '-m', 'graphify', '--version']],
  ])('uses the selected %s interpreter for fallback verification', (tool, args) => {
    expect(graphifyBootstrap.graphifyVersionCommand(tool)).toEqual(args);
  });

  // QNBS-v3: recovery fixtures preserve the last valid compact snapshot across interruptions.
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

  it('preserves an invalid compact report through runtime-only update backup handling', () => {
    const directory = mkdtempSync(join(tmpdir(), 'graphs-update-test-'));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, 'GRAPH_REPORT.md');
    const backupPath = `${reportPath}.previous-compact`;
    const invalid = '# Graph Report - interrupted\nmetadata only\n';
    writeFileSync(reportPath, invalid);
    expect(graphsCli.prepareGraphifyReportBackup(reportPath, backupPath)).toBe(true);
    expect(existsSync(reportPath)).toBe(false);
    graphsCli.restoreGraphifyReportBackup(true, reportPath, backupPath);
    expect(readFileSync(reportPath, 'utf-8')).toBe(invalid);
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
  });
});
