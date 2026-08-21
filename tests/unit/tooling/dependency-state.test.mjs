import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  calculateDependencyFingerprint,
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
