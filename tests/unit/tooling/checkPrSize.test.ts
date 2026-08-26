import { describe, expect, it } from 'vitest';
import {
  computeMeaningfulLines,
  evaluatePrSize,
  formatReport,
  isAllDocs,
  parseNumstat,
  selectSeverity,
} from '../../../scripts/check-pr-size.mjs';
import type { NumstatRow } from '../../../scripts/check-pr-size.d.mts';

// QNBS-v3: numstat uses "-\t-\tpath" for binary files — must parse as 0, not NaN.
describe('parseNumstat', () => {
  it('parses added/removed counts per file', () => {
    const rows = parseNumstat('10\t2\tsrc/foo.ts\n5\t0\tsrc/bar.ts\n');
    expect(rows).toEqual([
      { path: 'src/foo.ts', added: 10, removed: 2 },
      { path: 'src/bar.ts', added: 5, removed: 0 },
    ]);
  });

  it('treats a binary file row (-\\t-\\tpath) as 0 added/0 removed', () => {
    const rows = parseNumstat('-\t-\tsrc-tauri/icons/icon.png\n');
    expect(rows).toEqual([{ path: 'src-tauri/icons/icon.png', added: 0, removed: 0 }]);
  });

  it('ignores blank lines', () => {
    const rows = parseNumstat('1\t1\ta.ts\n\n2\t2\tb.ts\n');
    expect(rows).toHaveLength(2);
  });
});

describe('computeMeaningfulLines', () => {
  it('sums added+removed for ordinary code files', () => {
    const rows: NumstatRow[] = [
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
      { path: 'scripts/bar.mjs', added: 3, removed: 1 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(19);
  });

  // QNBS-v3: a locale bundle rebuild can churn thousands of lines without being a "real" change.
  it('zeroes out NON_CODE_ONLY files (e.g. locale bundles)', () => {
    const rows: NumstatRow[] = [
      { path: 'public/locales/de/writer/bundle.json', added: 5000, removed: 5000 },
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(15);
  });

  it('zeroes out pnpm-lock.yaml regardless of its classification', () => {
    const rows: NumstatRow[] = [
      { path: 'pnpm-lock.yaml', added: 2000, removed: 100 },
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(15);
  });
});

describe('isAllDocs', () => {
  it('is true when every changed file classifies as DOCS', () => {
    expect(isAllDocs([{ path: 'docs/CI.md', added: 1, removed: 1 }])).toBe(true);
  });

  it('is false when at least one file is not DOCS', () => {
    expect(
      isAllDocs([
        { path: 'docs/CI.md', added: 1, removed: 1 },
        { path: 'scripts/foo.mjs', added: 1, removed: 1 },
      ]),
    ).toBe(false);
  });

  it('is false for an empty change set (nothing to call "all docs")', () => {
    expect(isAllDocs([])).toBe(false);
  });
});

// QNBS-v3: absolute is a fixed ceiling; docsGovernance replaces hard (not target) for all-DOCS PRs.
describe('selectSeverity', () => {
  it('returns ok when within target', () => {
    const result = selectSeverity({ fileCount: 3, lineCount: 100, commitCount: 2, allDocs: false });
    expect(result.tier).toBe('ok');
    expect(result.blocking).toBe(false);
  });

  it('returns target when over target but within hard (normal profile)', () => {
    const result = selectSeverity({ fileCount: 10, lineCount: 500, commitCount: 7, allDocs: false });
    expect(result.tier).toBe('target');
    expect(result.blocking).toBe(false);
  });

  it('returns hard when over hard but within absolute (normal profile)', () => {
    const result = selectSeverity({ fileCount: 25, lineCount: 500, commitCount: 7, allDocs: false });
    expect(result.tier).toBe('hard');
    expect(result.blocking).toBe(false);
  });

  it('returns absolute (blocking) when over the absolute ceiling', () => {
    const result = selectSeverity({ fileCount: 35, lineCount: 500, commitCount: 7, allDocs: false });
    expect(result.tier).toBe('absolute');
    expect(result.blocking).toBe(true);
  });

  it('uses the docsGovernance profile (not hard) for an all-DOCS PR', () => {
    // Same borderline lineCount (over hard's 1200, under docsGovernance's 2400) classifies
    // differently by profile: 'hard' for code, only 'target' (the uniform baseline) for docs.
    const input = { fileCount: 5, lineCount: 1500, commitCount: 5 };
    expect(selectSeverity({ ...input, allDocs: false }).tier).toBe('hard');
    expect(selectSeverity({ ...input, allDocs: true }).tier).toBe('target');
  });

  it('flags docsGovernance when an all-DOCS PR exceeds its own limits', () => {
    const result = selectSeverity({ fileCount: 18, lineCount: 500, commitCount: 5, allDocs: true });
    expect(result.tier).toBe('docsGovernance');
    expect(result.blocking).toBe(false);
  });

  it('still applies the absolute ceiling to an all-DOCS PR', () => {
    const result = selectSeverity({ fileCount: 35, lineCount: 500, commitCount: 5, allDocs: true });
    expect(result.tier).toBe('absolute');
    expect(result.blocking).toBe(true);
  });
});

describe('formatReport', () => {
  it('reports "within target" for an ok result', () => {
    const severity = selectSeverity({ fileCount: 3, lineCount: 100, commitCount: 2, allDocs: false });
    const report = formatReport({ fileCount: 3, lineCount: 100, commitCount: 2, allDocs: false, severity });
    expect(report).toMatch(/within target/);
  });

  it('reports a blocking message for the absolute tier', () => {
    const severity = selectSeverity({ fileCount: 35, lineCount: 500, commitCount: 7, allDocs: false });
    const report = formatReport({ fileCount: 35, lineCount: 500, commitCount: 7, allDocs: false, severity });
    expect(report).toMatch(/exceeds the absolute ceiling/);
    expect(report).toMatch(/Split this PR/);
  });

  it('reports a non-blocking suggestion for the target/hard tiers', () => {
    const severity = selectSeverity({ fileCount: 25, lineCount: 500, commitCount: 7, allDocs: false });
    const report = formatReport({ fileCount: 25, lineCount: 500, commitCount: 7, allDocs: false, severity });
    expect(report).toMatch(/is over the hard tier/);
    expect(report).toMatch(/Consider splitting/);
  });
});

describe('evaluatePrSize', () => {
  // QNBS-v3: omits error entirely (not error: undefined) — required under exactOptionalPropertyTypes.
  const okGit = () => ({
    status: 0,
    stdout: '',
    stderr: '',
  });

  it('evaluates a small change as ok, using injected git output', () => {
    let call = 0;
    const spawnSync = () => {
      call += 1;
      return call === 1
        ? { ...okGit(), stdout: '10\t2\tscripts/foo.mjs\n' }
        : { ...okGit(), stdout: '2\n' };
    };
    const result = evaluatePrSize('base', 'head', { spawnSync });
    expect(result.ok).toBe(true);
    expect(result.fileCount).toBe(1);
    expect(result.lineCount).toBe(12);
    expect(result.commitCount).toBe(2);
    expect(result.severity?.tier).toBe('ok');
  });

  it('fails closed (ok: false) when git diff fails', () => {
    const spawnSync = () => ({ status: 1, stdout: '', stderr: 'fatal: bad range' });
    const result = evaluatePrSize('base', 'head', { spawnSync });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('fails closed (ok: false) when git rev-list fails', () => {
    let call = 0;
    const spawnSync = () => {
      call += 1;
      return call === 1
        ? { ...okGit(), stdout: '10\t2\tscripts/foo.mjs\n' }
        : { status: 1, stdout: '', stderr: 'fatal: bad range' };
    };
    const result = evaluatePrSize('base', 'head', { spawnSync });
    expect(result.ok).toBe(false);
  });

  it('fails closed (ok: false) on a spawn error (e.g. git not found)', () => {
    const spawnSync = () => ({ status: null, error: new Error('spawn git ENOENT'), stdout: '', stderr: '' });
    const result = evaluatePrSize('base', 'head', { spawnSync });
    expect(result.ok).toBe(false);
  });
});
