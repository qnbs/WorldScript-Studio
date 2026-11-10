import { describe, expect, it } from 'vitest';
import { shouldRunAdmissionCheck } from '../../../scripts/ci-prepush-check-registry.mjs';
import {
  isUnitTestFile,
  RELATED_TEST_LIMIT,
  relatedTestNeedles,
  selectRelatedTests,
} from '../../../scripts/ci-prepush-related-tests.mjs';

const present = () => true;

describe('related unit tests for local admission', () => {
  it.each([
    ['tests/unit/a.test.ts', true],
    ['components/Foo.test.tsx', true],
    ['scripts/check.test.mjs', true],
    ['tests/e2e/flow.spec.ts', false],
    ['tests/e2e/helpers.test.ts', false],
    ['tests/unit/a.ts', false],
    ['.worktrees/x/tests/unit/a.test.ts', false],
  ])('classifies %s as a unit test: %s', (file, expected) => {
    expect(isUnitTestFile(file)).toBe(expected);
  });

  it.each([
    ['.github/workflows/tauri-build.yml', ['.github/workflows/tauri-build.yml', 'tauri-build.yml']],
    [
      'scripts/release-security-gate.mjs',
      ['scripts/release-security-gate.mjs', 'release-security-gate.mjs'],
    ],
    [
      'services/aiProviderService.ts',
      ['services/aiProviderService.ts', 'services/aiProviderService'],
    ],
    ['features/lora/index.ts', ['features/lora/index.ts', 'features/lora/index']],
    ['config/csp-connect-src.json', ['config/csp-connect-src.json', 'csp-connect-src.json']],
    ['package.json', []],
    ['locales/en/common.json', []],
    ['README.md', []],
    ['tests/unit/a.test.ts', []],
  ])('derives the needles for %s', (file, expected) => {
    expect(relatedTestNeedles(file)).toEqual(expected);
  });

  it('selects the changed test files and the tests that mention a changed file, sorted and unique', () => {
    const mentions: Record<string, string[]> = {
      'tauri-build.yml': ['tests/unit/workflowPolicy.test.ts', 'tests/unit/a.test.ts'],
      'scripts/x.mjs': ['tests/unit/a.test.ts'],
    };
    const selection = selectRelatedTests(
      ['.github/workflows/tauri-build.yml', 'scripts/x.mjs', 'tests/unit/z.test.ts', 'README.md'],
      { search: (needle) => mentions[needle] ?? [], exists: present },
    );
    expect(selection).toEqual({
      status: 'RUN',
      tests: ['tests/unit/a.test.ts', 'tests/unit/workflowPolicy.test.ts', 'tests/unit/z.test.ts'],
      total: 3,
    });
  });

  it('ignores deleted tests, end-to-end specs and non-governed changes', () => {
    const selection = selectRelatedTests(
      ['tests/unit/deleted.test.ts', 'docs/CI.md', 'locales/en/common.json'],
      { search: () => ['tests/e2e/only.test.ts'], exists: () => false },
    );
    expect(selection).toEqual({ status: 'NONE', tests: [], total: 0 });
  });

  it('defers instead of silently dropping tests when more than the local limit match', () => {
    const many = Array.from(
      { length: RELATED_TEST_LIMIT + 1 },
      (_, i) => `tests/unit/t${i}.test.ts`,
    );
    const selection = selectRelatedTests(['scripts/x.mjs'], {
      search: () => many,
      exists: present,
    });
    expect(selection.status).toBe('DEFERRED');
    expect(selection.total).toBe(RELATED_TEST_LIMIT + 1);
    expect(selection.tests).toHaveLength(RELATED_TEST_LIMIT + 1);
  });

  it('runs exactly at the local limit', () => {
    const exact = Array.from({ length: RELATED_TEST_LIMIT }, (_, i) => `tests/unit/t${i}.test.ts`);
    expect(
      selectRelatedTests(['scripts/x.mjs'], { search: () => exact, exists: present }).status,
    ).toBe('RUN');
  });

  // The incident behind this check: the Tauri workflow tests were not run before a push that changed the workflow.
  it('selects the workflow tests that read a changed workflow file from disk', () => {
    const { tests } = selectRelatedTests(['.github/workflows/tauri-build.yml']);
    expect(tests).toEqual(
      expect.arrayContaining([
        'tests/unit/tooling/releaseSecurityGate.test.ts',
        'tests/unit/workflowPolicy.test.ts',
      ]),
    );
  });

  it('is routed by the admission registry for sources and for its own implementation', () => {
    expect(shouldRunAdmissionCheck('relatedTests', ['.github/workflows/tauri-build.yml'])).toBe(
      true,
    );
    expect(shouldRunAdmissionCheck('relatedTests', ['services/aiProviderService.ts'])).toBe(true);
    expect(shouldRunAdmissionCheck('relatedTests', ['scripts/ci-prepush-related-tests.mjs'])).toBe(
      true,
    );
    expect(shouldRunAdmissionCheck('relatedTests', ['README.md', 'docs/CI.md'])).toBe(false);
  });
});
