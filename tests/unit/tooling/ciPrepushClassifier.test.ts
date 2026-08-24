// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  classifyChangedFiles,
  classifyProcessResult,
  classifySignatureResult,
  isWorkflowPolicyFile,
  requiresTypecheck,
} from '../../../scripts/ci-prepush-classifier.mjs';

// QNBS-v3: lock the conservative classifier and explicit non-pass result states against regression.
describe('change-aware local admission classification', () => {
  it.each([
    [['docs/CI.md'], 'DOCS_ONLY', false],
    [['.github/workflows/ci.yml'], 'WORKFLOW_ONLY', false],
    [['docs/CI.md', '.github/workflows/ci.yml'], 'NON_CODE_ONLY', false],
    [['scripts/ci-prepush-lowend.mjs'], 'TOOLING', false],
    [['.gitleaks.toml'], 'TOOLING', false],
    [['tests/unit/tooling/ciPrepushClassifier.test.ts'], 'TYPESCRIPT_APPLICATION', true],
    [['tests/fixtures/project.txt'], 'TEST_ONLY', false],
    [['components/Editor.tsx'], 'TYPESCRIPT_APPLICATION', true],
    [['packages/desktop-contracts/src/index.ts'], 'DESKTOP_NATIVE_CONTRACT', true],
    [['src-tauri/src/main.rs'], 'RUST_TAURI', false],
    [['pnpm-lock.yaml'], 'DEPENDENCY_TOOLCHAIN', true],
    [['vite.config.ts'], 'BUILD_CONFIGURATION', true],
    [['components/Editor.tsx', 'src-tauri/src/main.rs'], 'MIXED', true],
    [['unclassified.bin'], 'AMBIGUOUS', true],
  ])('classifies %j as %s', (files, kind, typecheck) => {
    const classification = classifyChangedFiles(files);
    expect(classification.kind).toBe(kind);
    expect(requiresTypecheck(classification)).toBe(typecheck);
  });

  it('forces full TypeScript validation for the explicit full tier', () => {
    const classification = classifyChangedFiles(['docs/CI.md']);
    expect(requiresTypecheck(classification, { full: true })).toBe(true);
  });

  it('keeps workflow-policy checker changes on the workflow guard path', () => {
    const classification = classifyChangedFiles(['scripts/check-workflow-policy.mjs']);
    expect(classification.kind).toBe('TOOLING');
    expect(classification.files).toContain('scripts/check-workflow-policy.mjs');
    expect(isWorkflowPolicyFile('scripts/check-workflow-policy.mjs')).toBe(true);
  });
});

describe('local admission result semantics', () => {
  it('does not turn failures into passes', () => {
    expect(classifyProcessResult({ status: 1, signal: null, timedOut: false })).toBe('FAIL');
    expect(classifyProcessResult({ status: null, signal: 'SIGTERM', timedOut: false })).toBe(
      'LOCAL_RESOURCE_FAILURE',
    );
    expect(classifyProcessResult({ status: null, signal: null, timedOut: true })).toBe(
      'LOCAL_RESOURCE_FAILURE',
    );
    expect(classifyProcessResult({ status: 0, signal: null, timedOut: true })).toBe(
      'LOCAL_RESOURCE_FAILURE',
    );
    expect(classifySignatureResult(false)).toBe('FAIL');
    expect(classifySignatureResult(true)).toBe('PASS');
  });
});
