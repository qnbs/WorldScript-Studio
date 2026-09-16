import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../features/featureCatalog';
import {
  defaultFeatureFlagsState,
  type FeatureFlagsState,
} from '../../features/featureFlags/featureFlagsSlice';
import { FEATURE_TEST_COVERAGE } from '../../tests/e2e/config/featureTestCoverage';

const ALL_FLAG_KEYS = Object.keys(defaultFeatureFlagsState) as Array<keyof FeatureFlagsState>;

describe('FEATURE_TEST_COVERAGE (#709)', () => {
  // QNBS-v3: the registry's own `satisfies` position already makes a missing/retired flag a compile error -- runtime belt-and-suspenders against the live FEATURE_CATALOG set.
  it('covers every flag in the slice exactly once (no missing, no extra)', () => {
    const coverageKeys = Object.keys(FEATURE_TEST_COVERAGE).sort();
    const sliceKeys = [...ALL_FLAG_KEYS].sort();
    expect(coverageKeys).toEqual(sliceKeys);
  });

  it('declares only valid dispositions', () => {
    const validDispositions = new Set([
      'REQUIRED_FUNCTIONAL_E2E',
      'REQUIRED_SETTINGS_CONTRACT',
      'UNIT_OR_INTEGRATION_ONLY',
      'DESKTOP_ONLY_QUALIFICATION',
      'ADVISORY_REAL_RUNTIME',
      'NOT_APPLICABLE',
    ]);
    for (const [flag, coverage] of Object.entries(FEATURE_TEST_COVERAGE)) {
      expect(
        validDispositions.has(coverage.disposition),
        `${flag} has an invalid disposition`,
      ).toBe(true);
    }
  });

  it('never leaves blockingSpecs empty for a REQUIRED_* disposition', () => {
    for (const [flag, coverage] of Object.entries(FEATURE_TEST_COVERAGE)) {
      if (
        coverage.disposition === 'REQUIRED_FUNCTIONAL_E2E' ||
        coverage.disposition === 'REQUIRED_SETTINGS_CONTRACT'
      ) {
        expect(
          coverage.blockingSpecs.length,
          `${flag} is REQUIRED_* with no blockingSpecs`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('declares at least one runtime for every flag', () => {
    for (const [flag, coverage] of Object.entries(FEATURE_TEST_COVERAGE)) {
      expect(coverage.runtimes.length, `${flag} declares no runtimes`).toBeGreaterThan(0);
    }
  });

  // QNBS-v3: the "silently missing" invariant from #709, also enforced by scripts/check-feature-test-coverage.ts -- duplicated so plain `vitest` catches regressions too.
  it('gives every riskLevel:high flag either functional E2E coverage or an explicit rationale', () => {
    for (const entry of FEATURE_CATALOG) {
      if (entry.riskLevel !== 'high') continue;
      const coverage = FEATURE_TEST_COVERAGE[entry.flagKey];
      const hasStrongCoverage = coverage.disposition === 'REQUIRED_FUNCTIONAL_E2E';
      const hasRationale = Boolean(coverage.rationale?.trim());
      expect(
        hasStrongCoverage || hasRationale,
        `${entry.flagKey} is riskLevel:high with disposition ${coverage.disposition} and no rationale`,
      ).toBe(true);
    }
  });

  it('marks Rust Compute as desktop-only qualification', () => {
    expect(FEATURE_TEST_COVERAGE.enableRustCompute.disposition).toBe('DESKTOP_ONLY_QUALIFICATION');
    expect(FEATURE_TEST_COVERAGE.enableRustCompute.runtimes).toEqual(['desktop']);
  });
});
