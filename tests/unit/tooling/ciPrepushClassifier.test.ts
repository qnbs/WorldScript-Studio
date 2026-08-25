import { describe, expect, it } from 'vitest';
import { shouldRunAdmissionCheck } from '../../../scripts/ci-prepush-check-registry.mjs';
import {
  classifyChangedFiles,
  classifyFile,
  requiresTypecheck,
} from '../../../scripts/ci-prepush-classifier.mjs';

describe('change-aware local admission classifier', () => {
  it.each([
    ['README.md', 'DOCS'],
    ['.github/workflows/ci.yml', 'WORKFLOW'],
    ['tests/unit/example.test.ts', 'TYPESCRIPT_APPLICATION'],
    ['tests/fixtures/example.json', 'TEST_ONLY'],
    ['src-tauri/src/lib.rs', 'RUST_TAURI'],
    ['scripts/check-example.mjs', 'TOOLING'],
    ['unknown-extension.data', 'UNKNOWN'],
  ])('classifies %s as %s', (file, expected) => {
    expect(classifyFile(file)).toBe(expected);
  });

  it('runs TypeScript for TypeScript tests but defers non-TypeScript tests', () => {
    const ts = classifyChangedFiles(['tests/unit/example.test.ts']);
    const fixture = classifyChangedFiles(['tests/fixtures/example.json']);

    expect(ts.kind).toBe('TYPESCRIPT_APPLICATION');
    expect(requiresTypecheck(ts)).toBe(true);
    expect(fixture.kind).toBe('TEST_ONLY');
    expect(requiresTypecheck(fixture)).toBe(false);
  });

  it('uses the broad safe class for unknown or mixed changes', () => {
    const unknown = classifyChangedFiles(['README.md', 'new-file.data']);
    const mixed = classifyChangedFiles(['components/App.tsx', 'README.md']);

    expect(unknown.kind).toBe('AMBIGUOUS');
    expect(requiresTypecheck(unknown)).toBe(true);
    expect(mixed.kind).toBe('MIXED');
    expect(requiresTypecheck(mixed)).toBe(true);
  });

  it('routes only governed files and implementation changes to admission checks', () => {
    expect(shouldRunAdmissionCheck('i18n', ['locales/en/common.json'])).toBe(true);
    expect(shouldRunAdmissionCheck('i18n', ['README.md'])).toBe(false);
    expect(shouldRunAdmissionCheck('i18n', ['scripts/ci-prepush-classifier.mjs'])).toBe(true);
    expect(shouldRunAdmissionCheck('contentGuard', ['community-templates/index.json'])).toBe(true);
    expect(shouldRunAdmissionCheck('contentGuard', ['README.md'])).toBe(false);
  });
});
