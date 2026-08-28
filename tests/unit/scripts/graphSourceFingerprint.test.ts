// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildMetadataBlock,
  checkCleanState,
  computeSourceFingerprint,
  listSourcePaths,
} from '../../../scripts/graphSourceFingerprint.mjs';

let fixtureDir: string;

function git(args: string[], cwd = fixtureDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initFixture() {
  fixtureDir = mkdtempSync(join(tmpdir(), 'graph-fingerprint-test-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(fixtureDir, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(fixtureDir, '.gitignore'), 'graphify-out/\n.codegraph/\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
}

beforeEach(() => {
  initFixture();
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('graphSourceFingerprint', () => {
  it('is deterministic across repeated calls with no source change', () => {
    const first = computeSourceFingerprint(fixtureDir);
    const second = computeSourceFingerprint(fixtureDir);
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is worktree-aware: changes when an uncommitted file is edited', () => {
    const before = computeSourceFingerprint(fixtureDir);
    writeFileSync(join(fixtureDir, 'a.ts'), 'export const a = 2;\n');
    const after = computeSourceFingerprint(fixtureDir);
    expect(after).not.toBe(before);
  });

  it('is worktree-aware: changes when a new untracked source file is added', () => {
    const before = computeSourceFingerprint(fixtureDir);
    writeFileSync(join(fixtureDir, 'b.ts'), 'export const b = 1;\n');
    const after = computeSourceFingerprint(fixtureDir);
    expect(after).not.toBe(before);
  });

  it('excludes graphify-out/** and .codegraph/** from the fingerprint', () => {
    const before = computeSourceFingerprint(fixtureDir);
    // Directories are gitignored per the fixture's .gitignore, so these paths must not
    // participate even though they physically exist on disk.
    execFileSync('mkdir', ['-p', join(fixtureDir, 'graphify-out')]);
    writeFileSync(join(fixtureDir, 'graphify-out', 'GRAPH_REPORT.md'), 'irrelevant content');
    execFileSync('mkdir', ['-p', join(fixtureDir, '.codegraph')]);
    writeFileSync(join(fixtureDir, '.codegraph', 'CODEGRAPH_REPORT.md'), 'irrelevant content');
    const after = computeSourceFingerprint(fixtureDir);
    expect(after).toBe(before);
    expect(listSourcePaths(fixtureDir)).not.toContain('graphify-out/GRAPH_REPORT.md');
    expect(listSourcePaths(fixtureDir)).not.toContain('.codegraph/CODEGRAPH_REPORT.md');
  });

  it('is independent of commit SHA and branch name for identical content', () => {
    const onMain = computeSourceFingerprint(fixtureDir);
    git(['checkout', '-q', '-b', 'other-branch']);
    writeFileSync(join(fixtureDir, 'c.ts'), 'export const c = 1;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'second commit, different branch']);
    // Different branch, different HEAD SHA, but the tracked *content* now differs too --
    // add the same file back out to isolate the branch/SHA-independence claim.
    execFileSync('rm', [join(fixtureDir, 'c.ts')]);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'revert content to match main']);
    const onOtherBranch = computeSourceFingerprint(fixtureDir);
    expect(onOtherBranch).toBe(onMain);
  });

  describe('checkCleanState', () => {
    it('reports clean when there are no relevant working-tree changes', () => {
      const { clean, dirtyPaths } = checkCleanState(fixtureDir);
      expect(clean).toBe(true);
      expect(dirtyPaths).toEqual([]);
    });

    it('reports dirty (DIRTY_UNTRACKED_INPUT trigger) for an untracked source file', () => {
      writeFileSync(join(fixtureDir, 'untracked.ts'), 'export const u = 1;\n');
      const { clean, dirtyPaths } = checkCleanState(fixtureDir);
      expect(clean).toBe(false);
      expect(dirtyPaths).toContain('untracked.ts');
    });

    it('reports dirty for an uncommitted modification to a tracked file', () => {
      writeFileSync(join(fixtureDir, 'a.ts'), 'export const a = 999;\n');
      const { clean, dirtyPaths } = checkCleanState(fixtureDir);
      expect(clean).toBe(false);
      expect(dirtyPaths).toContain('a.ts');
    });

    it('does not flag changes confined to excluded graph-output directories', () => {
      execFileSync('mkdir', ['-p', join(fixtureDir, 'graphify-out')]);
      writeFileSync(join(fixtureDir, 'graphify-out', 'graph.json'), '{}');
      const { clean } = checkCleanState(fixtureDir);
      // graphify-out/ is gitignored in the fixture, so git status won't even list it --
      // this asserts the exclusion filter doesn't accidentally break the ignored-by-git case.
      expect(clean).toBe(true);
    });
  });

  describe('buildMetadataBlock', () => {
    it('embeds schema, fingerprint, tool, and version but never a timestamp or commit SHA', () => {
      const block = buildMetadataBlock({
        tool: 'graphifyy',
        toolVersion: '0.9.51',
        generationMode: 'AST-only local build',
        reportSchemaVersion: 1,
        cwd: fixtureDir,
      });
      expect(block).toContain('Report schema: 1');
      expect(block).toContain('Tool: graphifyy');
      expect(block).toContain('Tool version: 0.9.51');
      expect(block).toMatch(/Source fingerprint: sha256:[0-9a-f]{64}/);
      expect(block).not.toMatch(/Originating commit/i);
      expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // no ISO timestamp
    });
  });
});
