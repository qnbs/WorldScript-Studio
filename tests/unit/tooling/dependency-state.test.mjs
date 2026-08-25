import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  calculateDependencyFingerprint,
  calculateDependencyFingerprintFromRef,
  computeDependencyState,
  dependencyFilesFromRef,
  readStoredFingerprint,
  writeStoredFingerprint,
} from '../../../scripts/dependency-state.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeDependencyRoot() {
  const root = mkdtempSync(join(process.cwd(), '.worldscript-deps-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'packages', 'demo'), { recursive: true });
  mkdirSync(join(root, 'patches'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}\n');
  writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(join(root, 'packages', 'demo', 'package.json'), '{"name":"demo"}\n');
  writeFileSync(join(root, 'patches', 'demo.patch'), 'patch\n');
  return root;
}

describe('dependency fingerprint', () => {
  it('changes when a workspace dependency input changes', () => {
    const root = makeDependencyRoot();
    const before = calculateDependencyFingerprint(root);
    writeFileSync(join(root, 'package.json'), '{"dependencies":{"demo":"1.0.0"}}\n');
    assert.notEqual(calculateDependencyFingerprint(root), before);
  });

  it('stores and reads the reconciled fingerprint', () => {
    const root = makeDependencyRoot();
    const fingerprint = calculateDependencyFingerprint(root);
    writeStoredFingerprint(root, fingerprint);
    assert.equal(readStoredFingerprint(root), fingerprint);
  });

  it('changes when a patch changes', () => {
    const root = makeDependencyRoot();
    const before = calculateDependencyFingerprint(root);
    writeFileSync(join(root, 'patches', 'demo.patch'), 'changed patch\n');
    assert.notEqual(calculateDependencyFingerprint(root), before);
  });
});

describe('dependencyFilesFromRef (git-object-only, no worktree)', () => {
  it('includes root manifests, patches, and single-level package.json, excludes the rest', () => {
    const files = dependencyFilesFromRef('deadbeef', '/repo', {
      listTree: () => [
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'README.md',
        'patches/demo.patch',
        'patches/nested/also.patch',
        'packages/demo/package.json',
        'packages/demo/src/index.ts',
        'packages/demo/nested/package.json',
      ],
    });

    assert.deepEqual(files, [
      'package.json',
      'packages/demo/package.json',
      'patches/demo.patch',
      'patches/nested/also.patch',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ]);
  });

  it('returns null (not []) when the tree listing fails', () => {
    assert.equal(dependencyFilesFromRef('deadbeef', '/repo', { listTree: () => null }), null);
  });
});

describe('calculateDependencyFingerprintFromRef (git-object-only, no worktree)', () => {
  it('matches the filesystem fingerprint for the same paths and content', () => {
    const root = makeDependencyRoot();
    const filesystemFingerprint = calculateDependencyFingerprint(root);
    const contentByPath = {
      'package.json': '{}\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'packages/demo/package.json': '{"name":"demo"}\n',
      'patches/demo.patch': 'patch\n',
    };
    const refFingerprint = calculateDependencyFingerprintFromRef('deadbeef', root, {
      listTree: () => Object.keys(contentByPath),
      readFileAtRef: (relativePath) => contentByPath[relativePath],
    });

    assert.equal(refFingerprint, filesystemFingerprint);
  });

  it('returns null when a file read at the ref fails', () => {
    const result = calculateDependencyFingerprintFromRef('deadbeef', '/repo', {
      listTree: () => ['package.json'],
      readFileAtRef: () => null,
    });
    assert.equal(result, null);
  });
});

describe('computeDependencyState (diagnostic-only, isolated from canonical evidence)', () => {
  it('reports MATCHES when the ref fingerprint equals the stored baseline', () => {
    const state = computeDependencyState('deadbeef', '/repo', {
      readStoredFingerprint: () => 'abc123',
      calculateDependencyFingerprintFromRef: () => 'abc123',
    });
    assert.equal(state, 'MATCHES');
  });

  it('reports DIVERGED when the ref fingerprint differs from the stored baseline', () => {
    const state = computeDependencyState('deadbeef', '/repo', {
      readStoredFingerprint: () => 'abc123',
      calculateDependencyFingerprintFromRef: () => 'def456',
    });
    assert.equal(state, 'DIVERGED');
  });

  it('reports UNKNOWN when no baseline has been reconciled on this machine yet', () => {
    const state = computeDependencyState('deadbeef', '/repo', {
      readStoredFingerprint: () => null,
      calculateDependencyFingerprintFromRef: () => {
        throw new Error('must not be called without a baseline to compare against');
      },
    });
    assert.equal(state, 'UNKNOWN');
  });

  it('reports UNKNOWN when the ref fingerprint could not be established', () => {
    const state = computeDependencyState('deadbeef', '/repo', {
      readStoredFingerprint: () => 'abc123',
      calculateDependencyFingerprintFromRef: () => null,
    });
    assert.equal(state, 'UNKNOWN');
  });

  // QNBS-v3: an injected dependency that throws must not escape into resolvePushEvidence's catch.
  it('reports UNKNOWN rather than propagating a throw from an injected dependency', () => {
    const state = computeDependencyState('deadbeef', '/repo', {
      readStoredFingerprint: () => 'abc123',
      calculateDependencyFingerprintFromRef: () => {
        throw new Error('git show failed');
      },
    });
    assert.equal(state, 'UNKNOWN');
  });
});
