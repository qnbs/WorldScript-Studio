// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateBaseline,
  findViolations,
  getTrackedSourceFiles,
  isDirectExecution,
  resolveAuditableFiles,
  root,
} from '../../../scripts/audit-tokens.mjs';

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

// QNBS-v3: a disposable git fixture, matching the pattern in checkQnbsV3Comments.test.ts, needed here because readTrackedFileContent's index fallback (git show :<path>) requires a real git repository to exercise meaningfully.
function initGitFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'audit-tokens-git-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  // QNBS-v3: this repo enables commit.gpgsign globally; a fixture repo must not inherit that.
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

// QNBS-v3: resolveAuditableFiles never touches the filesystem, so these candidate paths are synthetic and need not exist on disk.
describe('resolveAuditableFiles (post-Visual qualification tranche, Section 3.1: git-tracked corpus resolution)', () => {
  it('includes a tracked file from a newly covered top-level directory (services/)', () => {
    const candidate = join(root, 'services', 'exampleService.ts');
    expect(resolveAuditableFiles([candidate])).toEqual([candidate]);
  });

  it('excludes ambient .d.ts declaration files even though their extension resolves to .ts', () => {
    const candidate = join(root, 'types', 'example.d.ts');
    expect(resolveAuditableFiles([candidate])).toEqual([]);
  });

  it('excludes build config files matched by the *.config.ts / *.config.js basename convention', () => {
    const candidates = [
      join(root, 'vite.config.ts'),
      join(root, 'vitest.config.ts'),
      join(root, 'playwright.config.ts'),
      join(root, 'some-tool.config.js'),
    ];
    expect(resolveAuditableFiles(candidates)).toEqual([]);
  });

  it('excludes files under the newly added directory segments (.storybook, .mcp)', () => {
    const candidates = [
      join(root, '.storybook', 'preview.tsx'),
      join(root, '.mcp', 'proforge-mcp-server', 'src', 'index.ts'),
    ];
    expect(resolveAuditableFiles(candidates)).toEqual([]);
  });

  it('keeps runtime-capable source under config/ in the corpus rather than excluding the whole directory (live review, PR #817): config/resolveViteBase.ts is genuinely imported by services/deployTarget.ts (GITHUB_PAGES_BASE), so a blanket "config" directory exclusion hid real runtime-consumed source', () => {
    const candidates = [
      join(root, 'config', 'resolveViteBase.ts'),
      join(root, 'config', 'runtime.ts'),
    ];
    expect(resolveAuditableFiles(candidates)).toEqual(candidates);
  });

  it('still excludes a genuine build-config file even when it lives under config/, via the *.config.ts basename rule rather than a directory-wide exclusion', () => {
    const candidate = join(root, 'config', 'something.config.ts');
    expect(resolveAuditableFiles([candidate])).toEqual([]);
  });

  it('excludes the explicitly listed permanent exemptions (service worker, generated EPUB stylesheet)', () => {
    // QNBS-v3: both run in an execution context with no document/CSSOM at all — see the EXCLUDED_FILES rationale comments.
    const candidates = [join(root, 'public', 'sw.js'), join(root, 'services', 'epubApiService.ts')];
    expect(resolveAuditableFiles(candidates)).toEqual([]);
  });

  it('still excludes files under the pre-existing directory segments (tests, stories, node_modules)', () => {
    const candidates = [
      join(root, 'tests', 'unit', 'example.test.ts'),
      join(root, 'stories', 'Example.stories.tsx'),
      join(root, 'node_modules', 'some-pkg', 'index.js'),
    ];
    expect(resolveAuditableFiles(candidates)).toEqual([]);
  });

  it('does not exclude real source merely because an ANCESTOR of the checkout shares a name with an excluded segment (Codex, PR #817)', () => {
    // QNBS-v3: repoRoot itself sits under a directory literally named "node_modules" — unrelated to this repo's own node_modules/ exclusion, which is what that segment is actually meant to cover.
    const repoRoot = join('/home', 'user', 'node_modules', 'WorldScript-Studio');
    const realSource = join(repoRoot, 'services', 'realService.ts');
    expect(resolveAuditableFiles([realSource], repoRoot)).toEqual([realSource]);
  });

  it('still excludes a file under the repo’s own node_modules/ directory when repoRoot is correctly the repo root', () => {
    const repoRoot = join('/home', 'user', 'node_modules', 'WorldScript-Studio');
    const ownNodeModulesFile = join(repoRoot, 'node_modules', 'some-pkg', 'index.ts');
    expect(resolveAuditableFiles([ownNodeModulesFile], repoRoot)).toEqual([]);
  });
});

describe('getTrackedSourceFiles (Codex, PR #817: NUL-delimited git ls-files output)', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('correctly recovers a tracked path containing non-ASCII characters, which git C-quotes/octal-escapes in its default newline-delimited output', () => {
    dir = initGitFixture();
    const subdir = join(dir, 'sübdir');
    mkdirSync(subdir);
    const file = join(subdir, 'ünïcode-file.ts');
    writeFileSync(file, "export const a = '#123456';\n");
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add unicode file']);
    expect(getTrackedSourceFiles(dir)).toEqual([file]);
  });
});

describe('evaluateBaseline (post-Visual qualification tranche, Section 3.2: true monotonic per-rule ratchet)', () => {
  const baseline = { total: 10, summary: { 'raw-hex': 6, 'inline-svg': 4 } };

  it('passes when every rule count matches the baseline exactly', () => {
    const audit = { total: 10, summary: { 'raw-hex': 6, 'inline-svg': 4 } };
    expect(evaluateBaseline(audit, baseline)).toEqual({ ok: true, reason: 'EXACT_MATCH' });
  });

  it('fails as a REGRESSION when one rule increases even though a compensating decrease keeps the aggregate total unchanged', () => {
    // QNBS-v3: replicates the PR #816 masking bug this ratchet must never reintroduce — an aggregate-only comparison would pass this case (10 === 10) and hide a real new violation.
    const audit = { total: 10, summary: { 'raw-hex': 7, 'inline-svg': 3 } };
    const verdict = evaluateBaseline(audit, baseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('REGRESSION');
    expect(verdict.detail).toContain('raw-hex: 7 > 6');
  });

  it('fails as STALE_HIGH_BASELINE when a rule count decreases without an explicit baseline refresh', () => {
    const audit = { total: 9, summary: { 'raw-hex': 5, 'inline-svg': 4 } };
    const verdict = evaluateBaseline(audit, baseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('STALE_HIGH_BASELINE');
    expect(verdict.detail).toContain('raw-hex: 5 < 6');
  });

  it('fails closed as MALFORMED_BASELINE when the stored total disagrees with its own summed per-rule breakdown', () => {
    const malformedBaseline = { total: 999, summary: { 'raw-hex': 6, 'inline-svg': 4 } };
    const audit = { total: 10, summary: { 'raw-hex': 6, 'inline-svg': 4 } };
    const verdict = evaluateBaseline(audit, malformedBaseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_BASELINE');
  });

  it('fails closed as MALFORMED_AUDIT when the audit total disagrees with its own summed per-rule breakdown', () => {
    const malformedAudit = { total: 999, summary: { 'raw-hex': 6, 'inline-svg': 4 } };
    const verdict = evaluateBaseline(malformedAudit, baseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_AUDIT');
  });

  it('passes a clean audit when no baseline has ever been recorded', () => {
    const audit = { total: 0, summary: {} };
    expect(evaluateBaseline(audit, null)).toEqual({
      ok: true,
      reason: 'NO_BASELINE_NO_VIOLATIONS',
    });
  });

  it('fails when violations exist and no baseline has ever been recorded', () => {
    const audit = { total: 3, summary: { 'raw-hex': 3 } };
    const verdict = evaluateBaseline(audit, null);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('NO_BASELINE_VIOLATIONS_FOUND');
  });

  it('fails as MALFORMED_AUDIT even when no baseline exists yet (Sourcery, PR #817: the malformed-audit check must not be masked by the no-baseline branch)', () => {
    const malformedAudit = { total: 999, summary: { 'raw-hex': 6, 'inline-svg': 4 } };
    const verdict = evaluateBaseline(malformedAudit, null);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_AUDIT');
  });

  it('fails as MALFORMED_BASELINE when the baseline has no summary object at all, rather than being normalized to an empty one (Sourcery, PR #817)', () => {
    // QNBS-v3: this baseline shape is deliberately invalid (no `summary`) to exercise the fail-closed path — not a shape a real caller should ever construct.
    const baselineWithoutSummary = { total: 5 } as unknown as Parameters<
      typeof evaluateBaseline
    >[1];
    const audit = { total: 5, summary: { 'raw-hex': 5 } };
    const verdict = evaluateBaseline(audit, baselineWithoutSummary);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_BASELINE');
  });

  // QNBS-v3 (Codex, PR #817): each case below is a value type sumSummary's '+' or the ratchet loop's '>'/'<' could otherwise coerce into silently matching — hasValidCounts must reject every one before any arithmetic runs.
  it.each([
    ['a string count', { 'raw-hex': '5' }, 5],
    ['a non-finite count (NaN)', { 'raw-hex': Number.NaN }, 0],
    ['a fractional count', { 'raw-hex': 5.5 }, 5.5],
    ['a negative count', { 'raw-hex': -5 }, -5],
  ])('fails as MALFORMED_BASELINE for %s in baseline.summary', (_label, summary, total) => {
    const malformedBaseline = { total, summary } as unknown as Parameters<
      typeof evaluateBaseline
    >[1];
    const audit = { total: 5, summary: { 'raw-hex': 5 } };
    const verdict = evaluateBaseline(audit, malformedBaseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_BASELINE');
  });

  it('fails as MALFORMED_AUDIT when audit.total itself is a non-integer type (a string), not just a per-rule value', () => {
    const malformedAudit = { total: '5', summary: { 'raw-hex': 5 } } as unknown as Parameters<
      typeof evaluateBaseline
    >[0];
    const verdict = evaluateBaseline(malformedAudit, baseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_AUDIT');
  });

  it('fails as MALFORMED_BASELINE when baseline.total is negative, even if it happens to equal the (also-invalid) summed summary', () => {
    // QNBS-v3: total(-5) === sum(-5) here — proves the fix is real numeric-contract validation, not just a disguised total-vs-sum consistency check that a self-consistent negative baseline could still slip past.
    const malformedBaseline = { total: -5, summary: { 'raw-hex': -5 } } as unknown as Parameters<
      typeof evaluateBaseline
    >[1];
    const audit = { total: 0, summary: { 'raw-hex': 0 } };
    const verdict = evaluateBaseline(audit, malformedBaseline);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('MALFORMED_BASELINE');
  });
});

describe('isDirectExecution (Sourcery, PR #817: platform/encoding-safe direct-entry detection)', () => {
  it('matches when the module URL is the pathToFileURL conversion of argv[1]', () => {
    const argv1 = '/tmp/some/path/audit-tokens.mjs';
    expect(isDirectExecution(argv1, pathToFileURL(argv1).href)).toBe(true);
  });

  it('matches even when argv[1] contains characters that URL-encode differently than the raw path (e.g. spaces)', () => {
    // QNBS-v3: a raw `file://${argv1}` string comparison fails this exact case — pathToFileURL encodes the space as %20, a plain template-literal concatenation never would.
    const argv1 = '/tmp/my project dir/audit-tokens.mjs';
    expect(isDirectExecution(argv1, pathToFileURL(argv1).href)).toBe(true);
  });

  it('returns false when argv[1] is undefined (module loaded without a script arg)', () => {
    expect(isDirectExecution(undefined, 'file:///tmp/audit-tokens.mjs')).toBe(false);
  });

  it('returns false when the module URL does not correspond to argv[1] (imported by another module, not run directly)', () => {
    const argv1 = '/tmp/some/other-entrypoint.mjs';
    expect(isDirectExecution(argv1, pathToFileURL('/tmp/audit-tokens.mjs').href)).toBe(false);
  });

  it('recognizes direct execution through a symlink, where Node resolves import.meta.url to the real target but leaves argv[1] as the symlink path (Codex, PR #817)', () => {
    // QNBS-v3 (CodeRabbit, PR #817): os.tmpdir() itself is a symlink on macOS (/tmp -> /private/tmp) — canonicalizing dir up front means `real`'s path already matches what fs.realpathSync(link) will produce, on every OS, rather than only on a platform where the OS temp dir happens not to be symlinked.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'audit-tokens-symlink-')));
    try {
      const real = join(dir, 'real-script.mjs');
      const link = join(dir, 'script-link.mjs');
      writeFileSync(real, '// placeholder\n');
      symlinkSync(real, link);
      // QNBS-v3: mirrors what Node actually does when a script is invoked through a symlink — argv[1] stays the invoked (symlink) path, import.meta.url resolves to the real file.
      expect(isDirectExecution(link, pathToFileURL(real).href)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recognizes direct execution through a symlink under --preserve-symlinks-main, where Node leaves import.meta.url as the unresolved symlink path too (live review, PR #817)', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'audit-tokens-symlink-')));
    try {
      const real = join(dir, 'real-script.mjs');
      const link = join(dir, 'script-link.mjs');
      writeFileSync(real, '// placeholder\n');
      symlinkSync(real, link);
      // QNBS-v3: under --preserve-symlinks-main, Node does NOT resolve the main module's symlink, so import.meta.url stays the symlink's own URL rather than the real target's — the opposite of the ordinary-resolution case above.
      expect(isDirectExecution(link, pathToFileURL(link).href)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recognizes direct execution when an ANCESTOR directory (not the script itself) is a symlink, matching the macOS /tmp -> /private/tmp pattern (CodeRabbit, PR #817)', () => {
    const realParent = mkdtempSync(join(tmpdir(), 'audit-tokens-real-parent-'));
    const ancestorLink = join(tmpdir(), `audit-tokens-ancestor-link-${process.pid}-${Date.now()}`);
    try {
      symlinkSync(realParent, ancestorLink, 'dir');
      const scriptViaLink = join(ancestorLink, 'script.mjs');
      const scriptViaReal = join(realParent, 'script.mjs');
      writeFileSync(scriptViaReal, '// placeholder\n');
      // QNBS-v3: argv1 traverses the symlinked ancestor directory (unresolved); moduleUrl is the fully canonical URL Node would actually produce — fs.realpathSync resolves every symlink in the path, not just a leaf component.
      expect(
        isDirectExecution(scriptViaLink, pathToFileURL(realpathSync(scriptViaReal)).href),
      ).toBe(true);
    } finally {
      rmSync(ancestorLink, { force: true });
      rmSync(realParent, { recursive: true, force: true });
    }
  });
});

describe('findViolations (regression guards for the PR #816 comment/string-literal and glass-token fixes)', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not treat a literal /* inside a quoted string/JSX attribute as opening a real block comment', () => {
    dir = mkdtempSync(join(tmpdir(), 'audit-tokens-test-'));
    const file = join(dir, 'Example.tsx');
    writeFileSync(
      file,
      [
        'export function Example() {',
        '  return <input accept="image/*" style={{ color: "#123456" }} />;',
        '}',
        '',
      ].join('\n'),
    );
    const { summary, total } = findViolations([file]);
    expect(total).toBe(1);
    expect(summary['raw-hex']).toBe(1);
  });

  it('flags a bare --glass-* token read via getComputedStyle, not just var(--glass-*) usage', () => {
    dir = mkdtempSync(join(tmpdir(), 'audit-tokens-test-'));
    const file = join(dir, 'Example.ts');
    writeFileSync(
      file,
      "export const bg = getComputedStyle(document.body).getPropertyValue('--glass-bg').trim();\n",
    );
    const { summary, total } = findViolations([file]);
    expect(total).toBe(1);
    expect(summary['ambient-glass-token']).toBe(1);
  });

  it('fails closed (throws) rather than silently skipping when a path is unreadable from both the working tree and the index (live review, PR #817: a path reaching findViolations was in the index moments ago — an unexpected git-show failure here must not be mistaken for "nothing to audit", since it could mask a real violation)', () => {
    dir = mkdtempSync(join(tmpdir(), 'audit-tokens-test-'));
    const present = join(dir, 'Present.ts');
    const missing = join(dir, 'NeverExisted.ts');
    writeFileSync(present, "export const bg = '#123456';\n");
    // QNBS-v3: no git repo exists in dir, so the index fallback for `missing` cannot succeed either — this must throw, not return a partial/silently-skipped result.
    expect(() => findViolations([present, missing])).toThrow();
  });

  it('reads a tracked file from the git index when it is deleted from the working tree but not staged, instead of silently skipping real content (live review, PR #817: git ls-files describes the index, not the working tree — an unstaged deletion still has real, trackable content that the next commit, and CI, would actually contain)', () => {
    dir = initGitFixture();
    const file = join(dir, 'Tracked.ts');
    writeFileSync(file, "export const bg = '#123456'; // committed\n");
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add Tracked.ts']);
    // QNBS-v3: stage a second, different violation before deleting the working-tree copy — proves the audit reads the INDEX's content (2 raw-hex), not the last commit's (1 raw-hex).
    writeFileSync(file, "export const bg = '#123456'; export const fg = '#abcdef';\n");
    git(dir, ['add', file]);
    rmSync(file); // delete from the working tree WITHOUT staging the deletion
    const { summary, total } = findViolations([file], dir);
    expect(total).toBe(2);
    expect(summary['raw-hex']).toBe(2);
  });

  it('excludes a staged deletion from the corpus entirely, rather than falling back to stale content (git ls-files never lists it once git rm has staged its removal)', () => {
    dir = initGitFixture();
    const file = join(dir, 'ToDelete.ts');
    writeFileSync(file, "export const bg = '#123456';\n");
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add ToDelete.ts']);
    git(dir, ['rm', '-q', file]);
    expect(getTrackedSourceFiles(dir)).not.toContain(file);
  });

  it('reads a nested tracked-but-unstaged-deleted file from the index (Codex, PR #817: the index pathspec is normalized to forward slashes before git show — this is a no-op on POSIX, where path.sep is already "/", but the same nested-path resolution path is what Windows relies on after the separator swap)', () => {
    dir = initGitFixture();
    const nestedDir = join(dir, 'services', 'sub');
    mkdirSync(nestedDir, { recursive: true });
    const file = join(nestedDir, 'Nested.ts');
    writeFileSync(file, "export const bg = '#123456';\n");
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'add Nested.ts']);
    rmSync(file); // delete from the working tree WITHOUT staging the deletion
    const { summary, total } = findViolations([file], dir);
    expect(total).toBe(1);
    expect(summary['raw-hex']).toBe(1);
  });
});
