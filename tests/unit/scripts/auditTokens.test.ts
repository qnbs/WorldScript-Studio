// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateBaseline,
  findViolations,
  resolveAuditableFiles,
  root,
} from '../../../scripts/audit-tokens.mjs';

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

  it('excludes files under the newly added directory segments (.storybook, .mcp, config)', () => {
    const candidates = [
      join(root, '.storybook', 'preview.tsx'),
      join(root, '.mcp', 'proforge-mcp-server', 'src', 'index.ts'),
      join(root, 'config', 'resolveViteBase.ts'),
    ];
    expect(resolveAuditableFiles(candidates)).toEqual([]);
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
});
