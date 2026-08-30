// @vitest-environment node
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// QNBS-v3: fixture coverage locks worktree deletion and portable content semantics used by reports.
import {
  buildMetadataBlock,
  checkCleanState,
  computeSourceFingerprint,
  listSourcePaths,
  matchesExactVersion,
} from '../../../scripts/graphSourceFingerprint.mjs';

let fixtureDir: string;

function git(args: string[], cwd = fixtureDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initFixture() {
  fixtureDir = mkdtempSync(join(process.cwd(), '.graph-fingerprint-test-'));
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

  it('preserves exact unusual Git path names through NUL enumeration', () => {
    writeFileSync(join(fixtureDir, 'fäll.ts'), 'export const umlaut = true;\n');
    writeFileSync(join(fixtureDir, 'file with spaces.ts'), 'export const spaced = true;\n');
    expect(listSourcePaths(fixtureDir)).toEqual(
      expect.arrayContaining(['fäll.ts', 'file with spaces.ts']),
    );
    expect(computeSourceFingerprint(fixtureDir)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('round-trips non-UTF-8 Git path bytes instead of treating the file as deleted', () => {
    const rawName = Buffer.from('bad-\xff.ts', 'latin1');
    const rawPath = Buffer.concat([Buffer.from(fixtureDir), Buffer.from('/'), rawName]);
    writeFileSync(rawPath, 'export const raw = 1;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'track raw pathname']);
    expect(
      listSourcePaths(fixtureDir).some((path) => Buffer.isBuffer(path) && path.equals(rawName)),
    ).toBe(true);
    const before = computeSourceFingerprint(fixtureDir);
    writeFileSync(rawPath, 'export const raw = 2;\n');
    expect(computeSourceFingerprint(fixtureDir)).not.toBe(before);
  });

  it('refuses a sparse checkout instead of treating omitted tracked files as deletions', () => {
    try {
      git(['update-index', '--skip-worktree', 'a.ts']);
      expect(() => computeSourceFingerprint(fixtureDir)).toThrow(/SPARSE_CHECKOUT_UNSUPPORTED/);
    } finally {
      git(['update-index', '--no-skip-worktree', 'a.ts']);
    }
  });

  it('refuses assume-unchanged tracked source entries', () => {
    git(['update-index', '--assume-unchanged', 'a.ts']);
    expect(() => computeSourceFingerprint(fixtureDir)).toThrow(/SOURCE_INDEX_FLAGS_UNSUPPORTED/);
  });

  it('hashes symlink targets without following them', () => {
    if (process.platform === 'win32') return;
    symlinkSync('a.ts', join(fixtureDir, 'link.ts'));
    git(['add', 'link.ts']);
    const first = computeSourceFingerprint(fixtureDir);
    // QNBS-v3: replace the tracked link to prove its target, not an extra path, changes the digest.
    rmSync(join(fixtureDir, 'link.ts'));
    symlinkSync('other.ts', join(fixtureDir, 'link.ts'));
    expect(computeSourceFingerprint(fixtureDir)).not.toBe(first);
  });

  it('preserves raw bytes when a symlink target contains invalid UTF-8', () => {
    if (process.platform === 'win32') return;
    const linkPath = join(fixtureDir, 'raw-link.ts');
    symlinkSync(Buffer.from([0x62, 0x61, 0x64, 0x2d, 0xff]), linkPath);
    git(['add', 'raw-link.ts']);
    const first = computeSourceFingerprint(fixtureDir);
    unlinkSync(linkPath);
    symlinkSync(Buffer.from([0x62, 0x61, 0x64, 0x2d, 0xfe]), linkPath);
    expect(computeSourceFingerprint(fixtureDir)).not.toBe(first);
  });

  it('hashes a materialized mode-120000 link like its symlink target', () => {
    if (process.platform === 'win32') return;
    symlinkSync('a.ts', join(fixtureDir, 'link.ts'));
    git(['add', 'link.ts']);
    const symlinkFingerprint = computeSourceFingerprint(fixtureDir);
    rmSync(join(fixtureDir, 'link.ts'));
    writeFileSync(join(fixtureDir, 'link.ts'), 'a.ts');
    expect(computeSourceFingerprint(fixtureDir)).toBe(symlinkFingerprint);
  });

  it('represents a tracked working-tree deletion without crashing', () => {
    const before = computeSourceFingerprint(fixtureDir);
    rmSync(join(fixtureDir, 'a.ts'));
    const after = computeSourceFingerprint(fixtureDir);
    expect(after).not.toBe(before);
    expect(checkCleanState(fixtureDir)).toEqual({ clean: false, dirtyPaths: ['a.ts'] });
  });

  it('treats equivalent UTF-8 LF and CRLF text as the same content', () => {
    writeFileSync(join(fixtureDir, 'a.ts'), 'export const a = 2;\n');
    const lf = computeSourceFingerprint(fixtureDir);
    writeFileSync(join(fixtureDir, 'a.ts'), 'export const a = 2;\r\n');
    expect(computeSourceFingerprint(fixtureDir)).toBe(lf);
  });

  it('keeps binary byte changes meaningful', () => {
    writeFileSync(join(fixtureDir, 'image.bin'), Buffer.from([0, 10, 13, 255]));
    const before = computeSourceFingerprint(fixtureDir);
    writeFileSync(join(fixtureDir, 'image.bin'), Buffer.from([0, 10, 13, 254]));
    expect(computeSourceFingerprint(fixtureDir)).not.toBe(before);
  });

  it('includes the normalized tracked executable mode', () => {
    if (process.platform === 'win32') return;
    const before = computeSourceFingerprint(fixtureDir);
    chmodSync(join(fixtureDir, 'a.ts'), 0o755);
    git(['update-index', '--chmod=+x', 'a.ts']);
    expect(computeSourceFingerprint(fixtureDir)).not.toBe(before);
  });

  it('includes tracked Gitlink object identity', () => {
    const childDir = join(fixtureDir, 'child');
    mkdirSync(childDir);
    git(['init', '-q'], childDir);
    git(['config', 'user.email', 'test@example.com'], childDir);
    git(['config', 'user.name', 'Test'], childDir);
    writeFileSync(join(childDir, 'nested.ts'), 'export const nested = 1;\n');
    git(['add', '-A'], childDir);
    git(['commit', '-q', '-m', 'child initial'], childDir);
    const firstObjectId = git(['rev-parse', 'HEAD'], childDir).trim();
    git(['update-index', '--add', '--cacheinfo', `160000,${firstObjectId},child`]);
    const first = computeSourceFingerprint(fixtureDir);
    writeFileSync(join(childDir, 'nested.ts'), 'export const nested = 2;\n');
    git(['add', '-A'], childDir);
    git(['commit', '-q', '-m', 'child second'], childDir);
    const secondObjectId = git(['rev-parse', 'HEAD'], childDir).trim();
    git(['update-index', '--add', '--cacheinfo', `160000,${secondObjectId},child`]);
    expect(computeSourceFingerprint(fixtureDir)).not.toBe(first);
  });

  it('excludes graphify-out/** and .codegraph/** from the fingerprint', () => {
    const before = computeSourceFingerprint(fixtureDir);
    // Directories are gitignored per the fixture's .gitignore, so these paths must not
    // participate even though they physically exist on disk.
    mkdirSync(join(fixtureDir, 'graphify-out'), { recursive: true });
    writeFileSync(join(fixtureDir, 'graphify-out', 'GRAPH_REPORT.md'), 'irrelevant content');
    mkdirSync(join(fixtureDir, '.codegraph'), { recursive: true });
    writeFileSync(join(fixtureDir, '.codegraph', 'CODEGRAPH_REPORT.md'), 'irrelevant content');
    const after = computeSourceFingerprint(fixtureDir);
    expect(after).toBe(before);
    expect(listSourcePaths(fixtureDir)).not.toContain('graphify-out/GRAPH_REPORT.md');
    expect(listSourcePaths(fixtureDir)).not.toContain('.codegraph/CODEGRAPH_REPORT.md');
  });

  it('excludes nested linked worktrees from the fingerprint', () => {
    const before = computeSourceFingerprint(fixtureDir);
    mkdirSync(join(fixtureDir, '.worktrees', 'feature'), { recursive: true });
    writeFileSync(
      join(fixtureDir, '.worktrees', 'feature', 'nested.ts'),
      'export const nested = true;\n',
    );
    expect(computeSourceFingerprint(fixtureDir)).toBe(before);
    expect(listSourcePaths(fixtureDir)).not.toContain('.worktrees/feature/nested.ts');
  });

  it('is independent of commit SHA and branch name for identical content', () => {
    const onMain = computeSourceFingerprint(fixtureDir);
    git(['checkout', '-q', '-b', 'other-branch']);
    writeFileSync(join(fixtureDir, 'c.ts'), 'export const c = 1;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'second commit, different branch']);
    // Different branch, different HEAD SHA, but the tracked *content* now differs too --
    // add the same file back out to isolate the branch/SHA-independence claim.
    rmSync(join(fixtureDir, 'c.ts'));
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

    it('reports both endpoints when an excluded report is renamed into source', () => {
      mkdirSync(join(fixtureDir, 'graphify-out'), { recursive: true });
      writeFileSync(join(fixtureDir, 'graphify-out', 'old.md'), 'report\n');
      git(['add', '-f', 'graphify-out/old.md']);
      git(['commit', '-q', '-m', 'track generated report']);
      git(['mv', 'graphify-out/old.md', 'included.ts']);
      const result = checkCleanState(fixtureDir);
      expect(result.clean).toBe(false);
      expect(result.dirtyPaths).toEqual(
        expect.arrayContaining(['included.ts', 'graphify-out/old.md']),
      );
    });

    it('reports both endpoints when source is renamed into an excluded report path', () => {
      mkdirSync(join(fixtureDir, 'graphify-out'), { recursive: true });
      git(['mv', 'a.ts', 'graphify-out/new.md']);
      const result = checkCleanState(fixtureDir);
      expect(result.clean).toBe(false);
      expect(result.dirtyPaths).toContain('graphify-out/new.md');
      expect(result.dirtyPaths).toContain('a.ts');
    });

    it('ignores a rename confined to excluded graph-output paths', () => {
      mkdirSync(join(fixtureDir, 'graphify-out'), { recursive: true });
      mkdirSync(join(fixtureDir, '.codegraph'), { recursive: true });
      writeFileSync(join(fixtureDir, 'graphify-out', 'old.md'), 'report\n');
      git(['add', '-f', 'graphify-out/old.md']);
      git(['commit', '-q', '-m', 'track generated report']);
      git(['mv', 'graphify-out/old.md', '.codegraph/new.md']);
      expect(checkCleanState(fixtureDir)).toEqual({ clean: true, dirtyPaths: [] });
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

    it('uses a supplied validated fingerprint without recomputing it', () => {
      const fingerprint = `sha256:${'a'.repeat(64)}`;
      expect(
        buildMetadataBlock({
          tool: 'codegraph',
          toolVersion: '1.6.0',
          generationMode: 'test',
          reportSchemaVersion: 1,
          cwd: fixtureDir,
          fingerprint,
        }),
      ).toContain(`Source fingerprint: ${fingerprint}`);
    });
  });

  // QNBS-v3: version tests lock the shared continuation-rejection contract used by report gates.
  it('shares exact version matching semantics with report generators', () => {
    expect(matchesExactVersion('graphify 0.9.51', '0.9.51')).toBe(true);
    expect(matchesExactVersion('1.6.0', '1.6.0')).toBe(true);
    expect(matchesExactVersion('graphify 0.9.50\nwarning: 0.9.51', '0.9.51')).toBe(false);
    expect(matchesExactVersion('graphify 0.9.51-rc.1', '0.9.51')).toBe(false);
  });
});
