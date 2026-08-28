import { describe, expect, it } from 'vitest';
import type { NumstatRow } from '../../../scripts/check-pr-size.d.mts';
import {
  computeGovernedFileCount,
  computeMeaningfulLines,
  computeNonExemptMeaningfulLines,
  computeSupplementalReportLines,
  evaluatePrSize,
  formatReport,
  isAllDocs,
  parseNumstat,
  selectSeverity,
} from '../../../scripts/check-pr-size.mjs';

const exception = {
  id: 'test-exception',
  repository: 'qnbs/WorldScript-Studio',
  prNumber: 539,
  baseRef: 'main',
  headRef: 'feature',
  maxFiles: 30,
  maxCommits: 15,
  maxNonExemptMeaningfulLines: 3000,
  supplementalLineAllowances: [
    { path: 'graphify-out/GRAPH_REPORT.md', maxMeaningfulLines: 5050 },
    { path: '.codegraph/CODEGRAPH_REPORT.md', maxMeaningfulLines: 150 },
  ],
  allowedPaths: [
    'scripts/tool.mjs',
    'graphify-out/GRAPH_REPORT.md',
    '.codegraph/CODEGRAPH_REPORT.md',
  ],
  reason: 'test',
};

function exceptionEvent() {
  return {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: '/tmp/pr-event.json',
  };
}

function pullRequestEvent({
  repository = exception.repository,
  number = exception.prNumber,
  baseRef = exception.baseRef,
  headRef = exception.headRef,
} = {}) {
  return {
    repository: { full_name: repository },
    number,
    pull_request: { base: { ref: baseRef }, head: { ref: headRef } },
  };
}

function exceptionDependencies({
  rows,
  changedPaths = rows.map((row) => row.path),
  registry = { schemaVersion: 1, exceptions: [exception] },
  event = {
    repository: { full_name: exception.repository },
    number: exception.prNumber,
    pull_request: { base: { ref: exception.baseRef }, head: { ref: exception.headRef } },
  },
  commitCount = 4,
  registryExists = true,
}: {
  rows: NumstatRow[];
  changedPaths?: string[];
  registry?: unknown;
  event?: unknown;
  commitCount?: number;
  registryExists?: boolean;
}) {
  const numstat = rows.map((row) => `${row.added}\t${row.removed}\t${row.path}\x00`).join('');
  const spawnSync = (_command: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === '--git-path')
      return { status: 1, stdout: '', stderr: '' };
    if (args[0] === 'diff' && args.includes('--numstat'))
      return { status: 0, stdout: numstat, stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-only')) {
      return { status: 0, stdout: `${changedPaths.join('\x00')}\x00`, stderr: '' };
    }
    if (args[0] === 'rev-list') return { status: 0, stdout: `${commitCount}\n`, stderr: '' };
    if (args[0] === 'rev-parse' && args[1] === '--verify')
      return { status: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'cat-file') {
      return { status: registryExists ? 0 : 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'show') return { status: 0, stdout: JSON.stringify(registry), stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected git call' };
  };
  return {
    spawnSync,
    env: exceptionEvent(),
    readFileSync: () => JSON.stringify(event),
  };
}

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

  it("preserves raw UTF-8 paths instead of git's octal-quoted representation", () => {
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
  it('zeroes out generated public/locales/<lang>/bundle.json bundles', () => {
    const rows: NumstatRow[] = [
      { path: 'public/locales/de/bundle.json', added: 5000, removed: 5000 },
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(15);
  });

  // QNBS-v3: locales/**/*.json is translator-authored source, not generated — must still count.
  it('still counts source locales/**/*.json edits as meaningful (not the generated bundle)', () => {
    const rows: NumstatRow[] = [
      { path: 'locales/de/writer.json', added: 200, removed: 50 },
      { path: 'public/locales/de/bundle.json', added: 5000, removed: 5000 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(250);
  });

  // QNBS-v3: build-i18n.mjs only ever writes <lang>/bundle.json — a same-named non-bundle file must still count.
  it('still counts a non-bundle file that happens to live under public/locales/<lang>/', () => {
    const rows: NumstatRow[] = [
      { path: 'public/locales/en/metadata.json', added: 300, removed: 100 },
      { path: 'public/locales/de/bundle.json', added: 5000, removed: 5000 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(400);
  });

  it('zeroes out pnpm-lock.yaml regardless of its classification', () => {
    const rows: NumstatRow[] = [
      { path: 'pnpm-lock.yaml', added: 2000, removed: 100 },
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(15);
  });

  // QNBS-v3: only index.json mirrors community-templates/ — content-guard.mjs never touches the locale variants.
  it('zeroes out only the content-guard-mirrored community-templates/index.json', () => {
    const rows: NumstatRow[] = [
      { path: 'public/community-templates/index.json', added: 300, removed: 300 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(0);
  });

  it('still counts hand-authored localized community-templates/index.<locale>.json as meaningful', () => {
    const rows: NumstatRow[] = [
      { path: 'public/community-templates/index.de.json', added: 300, removed: 100 },
    ];
    expect(computeMeaningfulLines(rows)).toBe(400);
  });
});

// QNBS-v3: a locale-parity edit always touches 19 rebuilt bundles — the file ceiling must exclude them too.
describe('computeGovernedFileCount', () => {
  it('counts ordinary code files', () => {
    const rows: NumstatRow[] = [
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
      { path: 'scripts/bar.mjs', added: 3, removed: 1 },
    ];
    expect(computeGovernedFileCount(rows)).toBe(2);
  });

  it('excludes generated public/locales/<lang>/bundle.json from the count', () => {
    const rows: NumstatRow[] = [
      { path: 'locales/de/writer.json', added: 200, removed: 50 },
      { path: 'public/locales/de/bundle.json', added: 5000, removed: 5000 },
    ];
    expect(computeGovernedFileCount(rows)).toBe(1);
  });

  it('still counts a non-bundle file under public/locales/<lang>/ in the file count too', () => {
    const rows: NumstatRow[] = [
      { path: 'public/locales/en/metadata.json', added: 300, removed: 100 },
      { path: 'public/locales/de/bundle.json', added: 5000, removed: 5000 },
    ];
    expect(computeGovernedFileCount(rows)).toBe(1);
  });

  it('excludes pnpm-lock.yaml from the count', () => {
    const rows: NumstatRow[] = [
      { path: 'pnpm-lock.yaml', added: 2000, removed: 100 },
      { path: 'scripts/foo.mjs', added: 10, removed: 5 },
    ];
    expect(computeGovernedFileCount(rows)).toBe(1);
  });

  // QNBS-v3: index.<locale>.json has no source-of-truth to regenerate from — it must stay governed.
  it('counts hand-authored localized community-templates/index.<locale>.json but not the index.json mirror', () => {
    const rows: NumstatRow[] = [
      { path: 'public/community-templates/index.json', added: 300, removed: 300 },
      { path: 'public/community-templates/index.de.json', added: 300, removed: 100 },
    ];
    expect(computeGovernedFileCount(rows)).toBe(1);
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
    const result = selectSeverity({
      fileCount: 10,
      lineCount: 500,
      commitCount: 7,
      allDocs: false,
    });
    expect(result.tier).toBe('target');
    expect(result.blocking).toBe(false);
  });

  it('returns hard when over hard but within absolute (normal profile)', () => {
    const result = selectSeverity({
      fileCount: 25,
      lineCount: 500,
      commitCount: 7,
      allDocs: false,
    });
    expect(result.tier).toBe('hard');
    expect(result.blocking).toBe(false);
  });

  it('returns absolute (blocking) when over the absolute ceiling', () => {
    const result = selectSeverity({
      fileCount: 35,
      lineCount: 500,
      commitCount: 7,
      allDocs: false,
    });
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
    const severity = selectSeverity({
      fileCount: 3,
      lineCount: 100,
      commitCount: 2,
      allDocs: false,
    });
    const report = formatReport({
      fileCount: 3,
      totalFileCount: 3,
      lineCount: 100,
      commitCount: 2,
      allDocs: false,
      severity,
    });
    expect(report).toMatch(/within target/);
  });

  it('reports a blocking message for the absolute tier', () => {
    const severity = selectSeverity({
      fileCount: 35,
      lineCount: 500,
      commitCount: 7,
      allDocs: false,
    });
    const report = formatReport({
      fileCount: 35,
      totalFileCount: 35,
      lineCount: 500,
      commitCount: 7,
      allDocs: false,
      severity,
    });
    expect(report).toMatch(/exceeds the absolute ceiling/);
    expect(report).toMatch(/Split this PR/);
  });

  it('reports a non-blocking suggestion for the target/hard tiers', () => {
    const severity = selectSeverity({
      fileCount: 25,
      lineCount: 500,
      commitCount: 7,
      allDocs: false,
    });
    const report = formatReport({
      fileCount: 25,
      totalFileCount: 25,
      lineCount: 500,
      commitCount: 7,
      allDocs: false,
      severity,
    });
    expect(report).toMatch(/is over the hard tier/);
    expect(report).toMatch(/Consider splitting/);
  });

  // QNBS-v3: surfaces the excluded generated count so the report isn't silently smaller than the real diff.
  it('notes the total file count when it exceeds the governed count', () => {
    const severity = selectSeverity({
      fileCount: 3,
      lineCount: 100,
      commitCount: 2,
      allDocs: false,
    });
    const report = formatReport({
      fileCount: 3,
      totalFileCount: 41,
      lineCount: 100,
      commitCount: 2,
      allDocs: false,
      severity,
    });
    expect(report).toMatch(/41 total incl\. generated/);
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
    const result = evaluatePrSize('base', 'head', { spawnSync, env: {} });
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
    const result = evaluatePrSize('base', 'head', { spawnSync, env: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('fails closed (ok: false) when git rev-list fails', () => {
    const spawnSync = (_cmd: string, args: string[]) => {
      if (args.includes('--git-path')) return { status: 1, stdout: '', stderr: '' };
      if (args[0] === 'diff') return { ...okGit(), stdout: '10\t2\tscripts/foo.mjs\x00' };
      return { status: 1, stdout: '', stderr: 'fatal: bad range' };
    };
    const result = evaluatePrSize('base', 'head', { spawnSync, env: {} });
    expect(result.ok).toBe(false);
  });

  it('fails closed (ok: false) on a spawn error (e.g. git not found)', () => {
    const spawnSync = () => ({
      status: null,
      error: new Error('spawn git ENOENT'),
      stdout: '',
      stderr: '',
    });
    const result = evaluatePrSize('base', 'head', { spawnSync, env: {} });
    expect(result.ok).toBe(false);
  });

  // QNBS-v3: a real atomic i18n edit (1 source file/locale + its rebuilt bundle) must not trip the file ceiling.
  it('does not block an atomic locale-parity change on the generated-bundle fan-out', () => {
    const langs = Array.from({ length: 19 }, (_, i) => `lang${i}`);
    const numstat = langs
      .flatMap((lang) => [
        `2\t0\tlocales/${lang}/writer.json\x00`,
        `40\t40\tpublic/locales/${lang}/bundle.json\x00`,
      ])
      .join('');
    const spawnSync = (_cmd: string, args: string[]) => {
      if (args.includes('--git-path')) return { status: 1, stdout: '', stderr: '' };
      if (args[0] === 'diff') return { ...okGit(), stdout: numstat };
      return { ...okGit(), stdout: '1\n' };
    };
    const result = evaluatePrSize('base', 'head', { spawnSync, env: {} });
    expect(result.ok).toBe(true);
    expect(result.totalFileCount).toBe(38);
    expect(result.fileCount).toBe(19);
    expect(result.severity?.tier).not.toBe('absolute');
  });

  describe('base-governed supplemental report budgets', () => {
    it('partitions ordinary lines from exact report-path allowances', () => {
      const rows: NumstatRow[] = [
        { path: 'scripts/tool.mjs', added: 2900, removed: 0 },
        { path: 'graphify-out/GRAPH_REPORT.md', added: 4569, removed: 0 },
        { path: '.codegraph/CODEGRAPH_REPORT.md', added: 92, removed: 0 },
      ];
      expect(computeNonExemptMeaningfulLines(rows, exception)).toBe(2900);
      expect(computeSupplementalReportLines(rows, exception)).toEqual({
        'graphify-out/GRAPH_REPORT.md': 4569,
        '.codegraph/CODEGRAPH_REPORT.md': 92,
      });
    });

    it('passes valid report churn while keeping non-exempt lines under 3000', () => {
      const rows: NumstatRow[] = [
        { path: 'scripts/tool.mjs', added: 2900, removed: 0 },
        { path: 'graphify-out/GRAPH_REPORT.md', added: 4569, removed: 0 },
        { path: '.codegraph/CODEGRAPH_REPORT.md', added: 92, removed: 0 },
      ];
      const result = evaluatePrSize('base', 'head', exceptionDependencies({ rows }));
      expect(result.ok).toBe(true);
      expect(result.severity?.blocking).toBe(false);
      expect(result.exception).toMatchObject({
        applied: true,
        id: 'test-exception',
        identityMatch: true,
        pathScopeMatch: true,
        baseGoverned: true,
      });
      expect(result.report).toContain('PR_SIZE_EXCEPTION=APPLIED');
      expect(result.report).toContain('outcome=within target');
      expect(result.report).toContain('NON_EXEMPT_MEANINGFUL_LINES=2900/3000');
    });

    it('blocks when non-exempt lines exceed the ordinary absolute ceiling', () => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 3001, removed: 0 }];
      const result = evaluatePrSize('base', 'head', exceptionDependencies({ rows }));
      expect(result.severity?.blocking).toBe(true);
      expect(result.report).toContain('NON_EXEMPT_MEANINGFUL_LINES=3001/3000');
    });

    it('blocks when a report exceeds its own supplemental allowance', () => {
      const rows: NumstatRow[] = [
        { path: 'graphify-out/GRAPH_REPORT.md', added: 5051, removed: 0 },
      ];
      const result = evaluatePrSize('base', 'head', exceptionDependencies({ rows }));
      expect(result.severity?.blocking).toBe(true);
      expect(result.report).toContain('graphify-out/GRAPH_REPORT.md=5051/5050');
    });

    it('cannot transfer unused allowance between report paths', () => {
      const rows: NumstatRow[] = [
        { path: 'graphify-out/GRAPH_REPORT.md', added: 5050, removed: 0 },
        { path: '.codegraph/CODEGRAPH_REPORT.md', added: 151, removed: 0 },
      ];
      const result = evaluatePrSize('base', 'head', exceptionDependencies({ rows }));
      expect(result.severity?.blocking).toBe(true);
    });

    it('rejects an out-of-scope path, including a same-named report elsewhere', () => {
      const rows: NumstatRow[] = [{ path: 'other/GRAPH_REPORT.md', added: 4000, removed: 0 }];
      const result = evaluatePrSize('base', 'head', exceptionDependencies({ rows }));
      expect(result.exception).toMatchObject({
        applied: false,
        identityMatch: true,
        pathScopeMatch: false,
      });
      expect(result.severity?.blocking).toBe(true);
    });

    it('rejects rename-style scope smuggling through the no-renames path list', () => {
      const rows: NumstatRow[] = [{ path: 'graphify-out/GRAPH_REPORT.md', added: 10, removed: 10 }];
      const result = evaluatePrSize(
        'base',
        'head',
        exceptionDependencies({
          rows,
          changedPaths: ['old/GRAPH_REPORT.md', 'graphify-out/GRAPH_REPORT.md'],
        }),
      );
      expect(result.exception?.pathScopeMatch).toBe(false);
    });

    it.each([
      ['repository', pullRequestEvent({ repository: 'other/repo' })],
      ['PR number', pullRequestEvent({ number: 540 })],
      ['base ref', pullRequestEvent({ baseRef: 'develop' })],
      ['head ref', pullRequestEvent({ headRef: 'other' })],
    ])('does not apply for a mismatched %s', (_label, event) => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 4000, removed: 0 }];
      const result = evaluatePrSize('base', 'head', exceptionDependencies({ rows, event }));
      expect(result.exception?.applied).toBe(false);
      expect(result.severity?.blocking).toBe(true);
    });

    it('does not apply without a pull_request event identity', () => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 4000, removed: 0 }];
      const result = evaluatePrSize('base', 'head', {
        ...exceptionDependencies({ rows }),
        env: {},
      });
      expect(result.exception?.applied).toBe(false);
      expect(result.severity?.blocking).toBe(true);
    });

    it('ignores a registry that exists only on the PR head', () => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 4000, removed: 0 }];
      const result = evaluatePrSize(
        'base',
        'head',
        exceptionDependencies({ rows, registryExists: false }),
      );
      expect(result.exception?.applied).toBe(false);
      expect(result.severity?.blocking).toBe(true);
    });

    it('fails closed for a malformed base registry', () => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 10, removed: 0 }];
      const result = evaluatePrSize('base', 'head', exceptionDependencies({ rows, registry: '{' }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('invalid config/pr-size-exceptions.json');
    });

    it('reports duplicate supplemental paths separately', () => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 10, removed: 0 }];
      const duplicateAllowance = {
        ...exception,
        supplementalLineAllowances: [
          { path: 'scripts/tool.mjs', maxMeaningfulLines: 10 },
          { path: 'scripts/tool.mjs', maxMeaningfulLines: 20 },
        ],
      };
      const result = evaluatePrSize(
        'base',
        'head',
        exceptionDependencies({
          rows,
          registry: { schemaVersion: 1, exceptions: [duplicateAllowance] },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('duplicate supplemental path scripts/tool.mjs');
      expect(result.error).not.toContain('is not in allowedPaths');
    });

    it('reports a supplemental path outside allowedPaths separately', () => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 10, removed: 0 }];
      const outOfScopeAllowance = {
        ...exception,
        supplementalLineAllowances: [{ path: 'other/GRAPH_REPORT.md', maxMeaningfulLines: 10 }],
      };
      const result = evaluatePrSize(
        'base',
        'head',
        exceptionDependencies({
          rows,
          registry: { schemaVersion: 1, exceptions: [outOfScopeAllowance] },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain(
        'supplemental path other/GRAPH_REPORT.md is not in allowedPaths',
      );
      expect(result.error).not.toContain('duplicate supplemental path');
    });

    it('fails closed for duplicate matching identities', () => {
      const rows: NumstatRow[] = [{ path: 'scripts/tool.mjs', added: 10, removed: 0 }];
      const duplicate = { ...exception, id: 'second-test-exception' };
      const result = evaluatePrSize(
        'base',
        'head',
        exceptionDependencies({
          rows,
          registry: { schemaVersion: 1, exceptions: [exception, duplicate] },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('ambiguous');
    });

    it('still enforces the exception file and commit ceilings', () => {
      const rows: NumstatRow[] = [
        { path: 'scripts/tool.mjs', added: 10, removed: 0 },
        { path: 'graphify-out/GRAPH_REPORT.md', added: 10, removed: 0 },
        { path: '.codegraph/CODEGRAPH_REPORT.md', added: 10, removed: 0 },
      ];
      const narrow = { ...exception, maxFiles: 2, allowedPaths: [...exception.allowedPaths] };
      const tooManyFiles = evaluatePrSize(
        'base',
        'head',
        exceptionDependencies({ rows, registry: { schemaVersion: 1, exceptions: [narrow] } }),
      );
      expect(tooManyFiles.severity?.blocking).toBe(true);
      const tooManyCommits = evaluatePrSize(
        'base',
        'head',
        exceptionDependencies({ rows, commitCount: 16 }),
      );
      expect(tooManyCommits.severity?.blocking).toBe(true);
    });
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
      writeFile(join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 3, 255, 254, 0, 0, 1]));
      git('add', '-A');
      git('commit', '-q', '-m', 'init');
      const base = git('rev-parse', 'HEAD').stdout.trim();

      writeFile(join(dir, '.gitattributes'), 'file.txt -diff\n');
      writeFile(join(dir, 'file.txt'), 'line1\nline2 CHANGED\nline3\nline4\n');
      // QNBS-v3: an ordinary binary edit, no gitattributes entry — must stay auto-detected as binary too.
      writeFile(join(dir, 'binary.bin'), Buffer.from([9, 8, 7, 6, 255, 254, 0, 0, 2, 3, 4]));
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
      const rows = JSON.parse(child.stdout) as Array<{
        path: string;
        added: number;
        removed: number;
      }>;
      const revealedRow = rows.find((row) => row.path === 'file.txt');
      expect(revealedRow?.added).toBeGreaterThan(0);

      // QNBS-v3: "!diff" unspecifies rather than forces text — a genuine binary must not get fake line counts.
      const binaryRow = rows.find((row) => row.path === 'binary.bin');
      expect(binaryRow).toEqual({ path: 'binary.bin', added: 0, removed: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
