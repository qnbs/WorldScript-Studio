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

// QNBS-v3: -z is NUL-delimited (git diff --numstat -z), not newline-delimited — matches real output.
describe('parseNumstat', () => {
  it('parses added/removed counts per file', () => {
    const rows = parseNumstat('10\t2\tsrc/foo.ts\x005\t0\tsrc/bar.ts\x00');
    expect(rows).toEqual([
      { path: 'src/foo.ts', added: 10, removed: 2 },
      { path: 'src/bar.ts', added: 5, removed: 0 },
    ]);
  });

  it('treats a binary file row (-\\t-\\tpath) as 0 added/0 removed', () => {
    const rows = parseNumstat('-\t-\tsrc-tauri/icons/icon.png\x00');
    expect(rows).toEqual([{ path: 'src-tauri/icons/icon.png', added: 0, removed: 0 }]);
  });

  it('ignores stray empty tokens', () => {
    const rows = parseNumstat('1\t1\ta.ts\x00\x002\t2\tb.ts\x00');
    expect(rows).toHaveLength(2);
  });

  // QNBS-v3: -z rename records are "nums\t\t" + old-path + new-path as 3 separate NUL-terminated tokens.
  it('parses a pure rename as one row under the new path, not delete+add', () => {
    const rows = parseNumstat('0\t0\t\x00old-name.ts\x00new-name.ts\x00');
    expect(rows).toEqual([{ path: 'new-name.ts', added: 0, removed: 0 }]);
  });

  it('parses a rename-with-edit as one row with the real delta, not the full file twice', () => {
    const rows = parseNumstat('3\t1\t\x00src/old.ts\x00src/new.ts\x00');
    expect(rows).toEqual([{ path: 'src/new.ts', added: 3, removed: 1 }]);
  });

  it('preserves raw UTF-8 paths instead of git\'s octal-quoted representation', () => {
    // -z output is raw UTF-8; the quoted "docs/\303\251.md" form only appears without -z.
    const rows = parseNumstat('1\t0\tdocs/spécial.md\x00');
    expect(rows).toEqual([{ path: 'docs/spécial.md', added: 1, removed: 0 }]);
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

  // QNBS-v3: a rebuilt public/ bundle can churn thousands of lines without being a "real" change.
  it('zeroes out generated public/locales bundles', () => {
    const rows: NumstatRow[] = [
      { path: 'public/locales/de/writer/bundle.json', added: 5000, removed: 5000 },
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(15);
  });

  // QNBS-v3: locales/**/*.json is translator-authored source, not generated — must still count.
  it('still counts source locales/**/*.json edits as meaningful (not the generated bundle)', () => {
    const rows: NumstatRow[] = [
      { path: 'locales/de/writer.json', added: 200, removed: 50 },
      { path: 'public/locales/de/writer/bundle.json', added: 5000, removed: 5000 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(250);
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
    // QNBS-v3: fail the info/attributes git-path lookup to skip that filesystem side effect here.
    const spawnSync = (_cmd: string, args: string[]) => {
      if (args.includes('--git-path')) return { status: 1, stdout: '', stderr: '' };
      if (args[0] === 'diff') return { ...okGit(), stdout: '10\t2\tscripts/foo.mjs\x00' };
      return { ...okGit(), stdout: '2\n' };
    };
    const result = evaluatePrSize('base', 'head', { spawnSync });
    expect(result.ok).toBe(true);
    expect(result.fileCount).toBe(1);
    expect(result.lineCount).toBe(12);
    expect(result.commitCount).toBe(2);
    expect(result.severity?.tier).toBe('ok');
  });

  it('fails closed (ok: false) when git diff fails', () => {
    const spawnSync = (_cmd: string, args: string[]) => {
      if (args.includes('--git-path')) return { status: 1, stdout: '', stderr: '' };
      return { status: 1, stdout: '', stderr: 'fatal: bad range' };
    };
    const result = evaluatePrSize('base', 'head', { spawnSync });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('fails closed (ok: false) when git rev-list fails', () => {
    const spawnSync = (_cmd: string, args: string[]) => {
      if (args.includes('--git-path')) return { status: 1, stdout: '', stderr: '' };
      if (args[0] === 'diff') return { ...okGit(), stdout: '10\t2\tscripts/foo.mjs\x00' };
      return { status: 1, stdout: '', stderr: 'fatal: bad range' };
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

// QNBS-v3: real git repo test — proves the info/attributes override defeats a PR-controlled -diff.
describe('getChangedFilesNumstat (gitattributes evasion protection, real git repo)', () => {
  it('still counts a change hidden by a PR-controlled "-diff" gitattributes entry', async () => {
    const { mkdtempSync, writeFileSync: writeFile, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync: realSpawnSync } = await import('node:child_process');
    const { pathToFileURL } = await import('node:url');

    const dir = mkdtempSync(join(tmpdir(), 'pr-size-attr-test-'));
    const git = (...args: string[]) => realSpawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    try {
      git('init', '-q');
      git('config', 'user.email', 'test@test.com');
      git('config', 'user.name', 'test');
      writeFile(join(dir, 'file.txt'), 'line1\nline2\nline3\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'init');
      const base = git('rev-parse', 'HEAD').stdout.trim();

      writeFile(join(dir, '.gitattributes'), 'file.txt -diff\n');
      writeFile(join(dir, 'file.txt'), 'line1\nline2 CHANGED\nline3\nline4\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'hide this change via -diff');
      const head = git('rev-parse', 'HEAD').stdout.trim();

      const { parseNumstat } = await import('../../../scripts/check-pr-size.mjs');

      const numstatWithoutFix = realSpawnSync(
        'git',
        ['diff', '--numstat', '-z', `${base}...${head}`],
        { cwd: dir, encoding: 'utf8' },
      ).stdout;
      const rowsWithoutFix = parseNumstat(numstatWithoutFix);
      const hiddenRow = rowsWithoutFix.find((row) => row.path === 'file.txt');
      expect(hiddenRow).toEqual({ path: 'file.txt', added: 0, removed: 0 });

      // QNBS-v3: process.chdir isn't supported in Vitest workers — spawn a real child node with cwd: dir instead.
      const scriptPath = join(process.cwd(), 'scripts', 'check-pr-size.mjs');
      const inline = `
        import { getChangedFilesNumstat, parseNumstat } from ${JSON.stringify(pathToFileURL(scriptPath).href)};
        const out = getChangedFilesNumstat(${JSON.stringify(base)}, ${JSON.stringify(head)}, {});
        console.log(JSON.stringify(parseNumstat(out)));
      `;
      const child = realSpawnSync(process.execPath, ['--input-type=module', '-e', inline], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(child.status).toBe(0);
      const rows = JSON.parse(child.stdout) as Array<{ path: string; added: number; removed: number }>;
      const revealedRow = rows.find((row) => row.path === 'file.txt');
      expect(revealedRow?.added).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
