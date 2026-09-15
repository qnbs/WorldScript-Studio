// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkFileContent,
  findBlockCommentViolations,
  findLineCommentViolations,
  findYamlConfigMarkerViolations,
  isGovernedPath,
  isWorkflowYamlPath,
  parseAddedLineNumbers,
  resolveUpstreamRef,
  runCheck,
} from '../../../scripts/check-qnbs-v3-comments.mjs';

let fixtureDir: string;

function git(args: string[], cwd = fixtureDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initFixture() {
  fixtureDir = mkdtempSync(join(process.cwd(), '.qnbs-v3-test-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  // QNBS-v3: this repo enables commit.gpgsign globally; a fixture repo must not inherit that.
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(fixtureDir, 'base.ts'), 'export const base = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
}

beforeEach(() => {
  initFixture();
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('parseAddedLineNumbers', () => {
  it('collects only + lines, mapped to new-file line numbers', () => {
    const diff = [
      '@@ -1,2 +1,3 @@',
      ' unchanged',
      '-removed',
      '+added one',
      '+added two',
      ' trailing unchanged',
      '',
    ].join('\n');
    expect(parseAddedLineNumbers(diff)).toEqual(new Set([2, 3]));
  });
});

describe('isGovernedPath / isWorkflowYamlPath', () => {
  it('governs known source extensions and excludes json', () => {
    expect(isGovernedPath('services/foo.ts')).toBe(true);
    expect(isGovernedPath('styles/app.css')).toBe(true);
    expect(isGovernedPath('src-tauri/src/main.rs')).toBe(true);
    expect(isGovernedPath('scripts/foo.d.mts')).toBe(true);
    expect(isGovernedPath('scripts/foo.cts')).toBe(true);
    expect(isGovernedPath('components/Foo.jsx')).toBe(true);
    expect(isGovernedPath('scripts/foo.cjs')).toBe(true);
    expect(isGovernedPath('package.json')).toBe(false);
    expect(isGovernedPath('locales/en/bundle.json')).toBe(false);
  });

  it('treats only .github/workflows and .github/actions yaml as workflow source', () => {
    expect(isWorkflowYamlPath('.github/workflows/ci.yml')).toBe(true);
    expect(isWorkflowYamlPath('.github/actions/setup/action.yml')).toBe(true);
    expect(isWorkflowYamlPath('codecov.yml')).toBe(false);
  });
});

describe('findLineCommentViolations', () => {
  it('passes a single physical-line rationale', () => {
    const lines = ['// QNBS-v3: One concise non-obvious concurrency rationale.', 'code();'];
    expect(findLineCommentViolations(lines, new Set([1]), '//')).toEqual([]);
  });

  it('flags a rationale that continues onto the next comment line', () => {
    const lines = [
      '// QNBS-v3: First half of rationale',
      '// continues the same rationale.',
      'code();',
    ];
    const violations = findLineCommentViolations(lines, new Set([1]), '//');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
  });

  it('does not flag an unrelated adjacent comment as a continuation', () => {
    const lines = [
      '// QNBS-v3: Concise rationale on one line.',
      '// eslint-disable-next-line no-console',
      'code();',
    ];
    expect(findLineCommentViolations(lines, new Set([1]), '//')).toEqual([]);
  });

  it('does not flag an untouched historical violation outside the added-line set', () => {
    const lines = [
      '// QNBS-v3: First half of rationale',
      '// continues the same rationale.',
      'code();',
    ];
    // Neither line reported as added by the diff — pre-existing debt stays unblocked.
    expect(findLineCommentViolations(lines, new Set(), '//')).toEqual([]);
  });

  it('allows mechanical code with no QNBS marker', () => {
    const lines = ['const x = 1;', 'const y = 2;'];
    expect(findLineCommentViolations(lines, new Set([1, 2]), '//')).toEqual([]);
  });

  it('flags a new continuation line appended below an unchanged, already-compliant marker', () => {
    const lines = [
      '// QNBS-v3: Already-compliant one-line rationale.',
      '// a newly added continuation.',
      'code();',
    ];
    // Only line 2 (the continuation) was added by this diff — the marker itself is untouched.
    const violations = findLineCommentViolations(lines, new Set([2]), '//');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
  });

  it("detects a trailing-comment marker (code; // QNBS-v3: ...), this repo's existing convention", () => {
    const lines = ['return failures; // QNBS-v3: One concise trailing rationale.', 'next();'];
    expect(findLineCommentViolations(lines, new Set([1]), '//')).toEqual([]);
  });

  it('flags a trailing-comment marker that gains an added continuation line', () => {
    const lines = [
      'return failures; // QNBS-v3: first half of the rationale',
      '// continues on its own line.',
      'next();',
    ];
    const violations = findLineCommentViolations(lines, new Set([1]), '//');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
  });

  it('does not treat a continuation-shaped trailing comment as extending a prior marker', () => {
    // The second line has code before its comment, so it can never be a pure continuation line.
    const lines = [
      '// QNBS-v3: One concise rationale on one physical line.',
      'other(); // unrelated trailing note',
    ];
    expect(findLineCommentViolations(lines, new Set([1, 2]), '//')).toEqual([]);
  });

  it('does not detect a QNBS-v3-looking token sequence inside a string literal', () => {
    const lines = ["const msg = 'not a // QNBS-v3: marker, just text';", 'code();'];
    expect(findLineCommentViolations(lines, new Set([1]), '//')).toEqual([]);
  });
});

describe('findBlockCommentViolations (CSS)', () => {
  it('passes a single-line block comment', () => {
    const lines = ['/* QNBS-v3: token drives the focus ring width. */', '.btn { color: red; }'];
    expect(findBlockCommentViolations(lines, new Set([1]))).toEqual([]);
  });

  it('flags a block comment that does not close on the same line', () => {
    const lines = ['/* QNBS-v3: this rationale', 'spans a second physical line. */', '.btn {}'];
    const violations = findBlockCommentViolations(lines, new Set([1]));
    expect(violations).toHaveLength(1);
  });

  it('flags an unchanged opener when only the added continuation/closer line is new', () => {
    const lines = [
      '/* QNBS-v3: this rationale',
      'spans a second physical line, newly added. */',
      '.btn {}',
    ];
    // Only line 2 was added — the opener on line 1 is pre-existing.
    const violations = findBlockCommentViolations(lines, new Set([2]));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
  });

  it('does not flag an untouched historical multi-line block comment', () => {
    const lines = ['/* QNBS-v3: legacy rationale', 'legacy continuation. */', '.btn {}'];
    expect(findBlockCommentViolations(lines, new Set())).toEqual([]);
  });
});

describe('findYamlConfigMarkerViolations', () => {
  it('allows a QNBS-v3 marker in workflow yaml', () => {
    const lines = ['# QNBS-v3: pin third-party actions to a full commit SHA.', 'jobs: {}'];
    expect(findYamlConfigMarkerViolations(lines, new Set([1]), '.github/workflows/ci.yml')).toEqual(
      [],
    );
  });

  it('flags a QNBS-v3 marker introduced in non-workflow yaml config', () => {
    const lines = ['# QNBS-v3: explains a threshold choice.', 'bundle_analysis: {}'];
    const violations = findYamlConfigMarkerViolations(lines, new Set([1]), 'codecov.yml');
    expect(violations).toHaveLength(1);
  });
});

describe('checkFileContent', () => {
  it('handles CRLF line endings without false positives', () => {
    const content = '// QNBS-v3: One concise rationale on one physical line.\r\ncode();\r\n';
    const diff = [
      '@@ -0,0 +1,2 @@',
      '+// QNBS-v3: One concise rationale on one physical line.',
      '+code();',
      '',
    ].join('\n');
    expect(checkFileContent('services/foo.ts', content, diff)).toEqual([]);
  });

  it('flags a CRLF two-line continuation', () => {
    const content = '// QNBS-v3: first half\r\n// second half.\r\ncode();\r\n';
    const diff = [
      '@@ -0,0 +1,3 @@',
      '+// QNBS-v3: first half',
      '+// second half.',
      '+code();',
      '',
    ].join('\n');
    expect(checkFileContent('services/foo.ts', content, diff)).toHaveLength(1);
  });

  it('ignores files with no recognized comment style', () => {
    expect(
      checkFileContent('README.md', '// QNBS-v3: not governed\nnot code', '@@ -0,0 +1,2 @@'),
    ).toEqual([]);
  });
});

describe('runCheck (real git fixture, staged mode)', () => {
  it('treats a staged deletion of a governed file as a skip, not a failure, under a non-English system locale', () => {
    // QNBS-v3: git's own stderr is locale-dependent; this proves the LC_ALL=C override survives it.
    const original = { LANG: process.env['LANG'], LC_ALL: process.env['LC_ALL'] };
    process.env['LANG'] = 'de_DE.UTF-8';
    process.env['LC_ALL'] = 'de_DE.UTF-8';
    try {
      git(['rm', '--cached', '-q', 'base.ts']);
      const result = runCheck({ mode: 'staged', cwd: fixtureDir });
      expect(result.failedClosed).toBe(false);
      expect(result.ok).toBe(true);
    } finally {
      if (original.LANG === undefined) delete process.env['LANG'];
      else process.env['LANG'] = original.LANG;
      if (original.LC_ALL === undefined) delete process.env['LC_ALL'];
      else process.env['LC_ALL'] = original.LC_ALL;
    }
  });

  it('passes a clean single-line addition', () => {
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      'export const base = 1;\n// QNBS-v3: One concise non-obvious rationale.\nexport const c = 2;\n',
    );
    git(['add', '-A']);
    const result = runCheck({ mode: 'staged', cwd: fixtureDir });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fails a newly staged multi-line rationale', () => {
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      'export const base = 1;\n// QNBS-v3: first half\n// continues here.\nexport const c = 2;\n',
    );
    git(['add', '-A']);
    const result = runCheck({ mode: 'staged', cwd: fixtureDir });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.file).toBe('base.ts');
  });

  it('validates the staged (index) content, not a further-dirtied working tree', () => {
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      'export const base = 1;\n// QNBS-v3: One concise non-obvious rationale.\nexport const c = 2;\n',
    );
    git(['add', '-A']);
    // Working tree now diverges from the index with an unstaged multi-line violation.
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      'export const base = 1;\n// QNBS-v3: One concise non-obvious rationale.\n// with an unstaged continuation.\nexport const c = 2;\n',
    );
    const result = runCheck({ mode: 'staged', cwd: fixtureDir });
    expect(result.ok).toBe(true);
  });

  it('does not pass a staged violation merely because the working tree was fixed without re-staging', () => {
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      'export const base = 1;\n// QNBS-v3: first half\n// continues here.\nexport const c = 2;\n',
    );
    git(['add', '-A']);
    // Working tree "fix" never staged — the index still holds the violation.
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      'export const base = 1;\n// QNBS-v3: fixed single line.\nexport const c = 2;\n',
    );
    const result = runCheck({ mode: 'staged', cwd: fixtureDir });
    expect(result.ok).toBe(false);
  });

  it('does not block on an untouched historical violation elsewhere in the same file', () => {
    // Commit a pre-existing multi-line violation as history first.
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      '// QNBS-v3: legacy first half\n// legacy continues.\nexport const base = 1;\n',
    );
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'legacy debt']);
    // Now stage an unrelated, compliant addition to the same file.
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      '// QNBS-v3: legacy first half\n// legacy continues.\nexport const base = 1;\nexport const d = 2;\n',
    );
    git(['add', '-A']);
    const result = runCheck({ mode: 'staged', cwd: fixtureDir });
    expect(result.ok).toBe(true);
  });

  it('ignores generated/unrelated file types entirely', () => {
    writeFileSync(join(fixtureDir, 'notes.md'), '// QNBS-v3: first half\n// continues.\n');
    git(['add', '-A']);
    const result = runCheck({ mode: 'staged', cwd: fixtureDir });
    expect(result.ok).toBe(true);
  });
});

describe('runCheck (real git fixture, range mode)', () => {
  it('checks only the diff against the given ref', () => {
    const baseRef = git(['rev-parse', 'HEAD']).trim();
    writeFileSync(
      join(fixtureDir, 'base.ts'),
      'export const base = 1;\n// QNBS-v3: first half\n// continues.\nexport const d = 2;\n',
    );
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'range change']);
    const result = runCheck({ mode: 'range', ref: baseRef, cwd: fixtureDir });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
  });
});

describe('resolveUpstreamRef', () => {
  it('falls back to PR_BUDGET_BASE when a branch has no upstream yet (first push)', () => {
    const baseRef = git(['rev-parse', 'HEAD']).trim();
    // A freshly created branch in this fixture has no @{upstream} configured.
    git(['checkout', '-q', '-b', 'no-upstream-yet']);
    const original = process.env['PR_BUDGET_BASE'];
    process.env['PR_BUDGET_BASE'] = baseRef;
    try {
      expect(resolveUpstreamRef(fixtureDir)).toBe(baseRef);
    } finally {
      if (original === undefined) delete process.env['PR_BUDGET_BASE'];
      else process.env['PR_BUDGET_BASE'] = original;
    }
  });

  it('returns null when neither @{upstream} nor PR_BUDGET_BASE is available', () => {
    git(['checkout', '-q', '-b', 'still-no-upstream']);
    const original = process.env['PR_BUDGET_BASE'];
    delete process.env['PR_BUDGET_BASE'];
    try {
      expect(resolveUpstreamRef(fixtureDir)).toBeNull();
    } finally {
      if (original !== undefined) process.env['PR_BUDGET_BASE'] = original;
    }
  });

  it('trims whitespace/newlines from PR_BUDGET_BASE before using it as a git ref', () => {
    const baseRef = git(['rev-parse', 'HEAD']).trim();
    git(['checkout', '-q', '-b', 'no-upstream-whitespace']);
    const original = process.env['PR_BUDGET_BASE'];
    process.env['PR_BUDGET_BASE'] = `  ${baseRef}\n`;
    try {
      expect(resolveUpstreamRef(fixtureDir)).toBe(baseRef);
    } finally {
      if (original === undefined) delete process.env['PR_BUDGET_BASE'];
      else process.env['PR_BUDGET_BASE'] = original;
    }
  });

  it('treats a whitespace-only PR_BUDGET_BASE as absent', () => {
    git(['checkout', '-q', '-b', 'no-upstream-blank']);
    const original = process.env['PR_BUDGET_BASE'];
    process.env['PR_BUDGET_BASE'] = '   ';
    try {
      expect(resolveUpstreamRef(fixtureDir)).toBeNull();
    } finally {
      if (original === undefined) delete process.env['PR_BUDGET_BASE'];
      else process.env['PR_BUDGET_BASE'] = original;
    }
  });
});
