import { describe, expect, it } from 'vitest';
import { shouldRunAdmissionCheck } from '../../../scripts/ci-prepush-check-registry.mjs';
import {
  classifyChangedFiles,
  classifyFile,
  manualAdmissionNeedsFullValidation,
  requiresTypecheck,
} from '../../../scripts/ci-prepush-classifier.mjs';

describe('change-aware local admission classifier', () => {
  it.each([
    ['README.md', 'DOCS'],
    ['.github/workflows/ci.yml', 'WORKFLOW'],
    ['tests/unit/example.test.ts', 'TYPESCRIPT_APPLICATION'],
    ['tests/fixtures/example.json', 'TYPESCRIPT_APPLICATION'],
    ['tests/unit/example.test.ts.snap', 'TEST_ONLY'],
    ['tests/unit/tooling/other-artifact.json', 'TEST_ONLY'],
    ['src-tauri/src/lib.rs', 'RUST_TAURI'],
    ['scripts/check-example.mjs', 'TOOLING'],
    ['scripts/coverage-thresholds.json', 'TYPESCRIPT_APPLICATION'],
    ['locales/en/common.json', 'NON_CODE_ONLY'],
    ['public/locales/en/bundle.json', 'NON_CODE_ONLY'],
    ['community-templates/index.json', 'NON_CODE_ONLY'],
    ['public/community-templates/index.json', 'NON_CODE_ONLY'],
    ['unknown-extension.data', 'UNKNOWN'],
  ])('classifies %s as %s', (file, expected) => {
    expect(classifyFile(file)).toBe(expected);
  });

  // QNBS-v3: i18n/content-template-only pushes must not trigger typecheck (efficiency, not safety).
  it('does not require typecheck for i18n or community-template-only changes', () => {
    const i18nOnly = classifyChangedFiles(['locales/en/common.json', 'locales/de/common.json']);
    const templateOnly = classifyChangedFiles(['community-templates/index.json']);
    const i18nWithDocs = classifyChangedFiles(['locales/en/common.json', 'README.md']);

    expect(i18nOnly.kind).toBe('NON_CODE_ONLY');
    expect(requiresTypecheck(i18nOnly)).toBe(false);
    expect(templateOnly.kind).toBe('NON_CODE_ONLY');
    expect(requiresTypecheck(templateOnly)).toBe(false);
    expect(i18nWithDocs.kind).toBe('NON_CODE_ONLY');
    expect(requiresTypecheck(i18nWithDocs)).toBe(false);
  });

  it('runs TypeScript for TypeScript tests but defers non-TypeScript, non-JSON test assets', () => {
    const ts = classifyChangedFiles(['tests/unit/example.test.ts']);
    const snapshot = classifyChangedFiles(['tests/unit/example.test.ts.snap']);

    expect(ts.kind).toBe('TYPESCRIPT_APPLICATION');
    expect(requiresTypecheck(ts)).toBe(true);
    expect(snapshot.kind).toBe('TEST_ONLY');
    expect(requiresTypecheck(snapshot)).toBe(false);
  });

  // QNBS-v3: redaction-cases.json gets inferred TS types in logger.test.ts — typecheck fixture JSON.
  it('requires typecheck for a JSON test fixture despite living under tests/', () => {
    const classification = classifyChangedFiles([
      'tests/fixtures/diagnostics/redaction-cases.json',
    ]);

    expect(classification.kind).toBe('TYPESCRIPT_APPLICATION');
    expect(requiresTypecheck(classification)).toBe(true);
  });

  it('requires typecheck for a coverage-thresholds.json-only change despite living under scripts/', () => {
    const classification = classifyChangedFiles(['scripts/coverage-thresholds.json']);

    expect(classification.kind).toBe('TYPESCRIPT_APPLICATION');
    expect(requiresTypecheck(classification)).toBe(true);
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
    expect(shouldRunAdmissionCheck('i18n', ['scripts/build-i18n.mjs'])).toBe(true);
    expect(shouldRunAdmissionCheck('i18n', ['scripts/i18n-quality-report.mjs'])).toBe(true);
    expect(shouldRunAdmissionCheck('contentGuard', ['community-templates/index.json'])).toBe(true);
    expect(shouldRunAdmissionCheck('contentGuard', ['README.md'])).toBe(false);
    expect(shouldRunAdmissionCheck('i18n', ['scripts/ci-prepush-lowend.mjs'])).toBe(true);
    expect(shouldRunAdmissionCheck('contentGuard', ['scripts/ci-prepush-lowend.mjs'])).toBe(true);
    // QNBS-v3: the range resolver decides what's admitted — it must self-route like the classifier.
    expect(shouldRunAdmissionCheck('i18n', ['scripts/ci-prepush-range-resolver.mjs'])).toBe(true);
    expect(shouldRunAdmissionCheck('contentGuard', ['scripts/ci-prepush-range-resolver.mjs'])).toBe(
      true,
    );
  });

  it('keeps TypeScript tooling files in the typecheck-required class', () => {
    const classification = classifyChangedFiles([
      'scripts/check-tooling.ts',
      'scripts/types.d.mts',
    ]);

    expect(classification.kind).toBe('TYPESCRIPT_APPLICATION');
    expect(requiresTypecheck(classification)).toBe(true);
  });

  it('requires conservative full admission when the manual range is unresolved', () => {
    expect(manualAdmissionNeedsFullValidation(true)).toBe(false);
    expect(manualAdmissionNeedsFullValidation(false)).toBe(true);

    const earlierTypeScript = classifyChangedFiles(['src/app.tsx']);

    expect(requiresTypecheck(earlierTypeScript)).toBe(true);
  });
});
