#!/usr/bin/env tsx

/**
 * Feature Test Coverage Authority Check (#709)
 * QNBS-v3: Validates what `tests/e2e/config/featureTestCoverage.ts`'s own
 * `satisfies Record<keyof FeatureFlagsState, FeatureTestCoverage>` cannot prove at compile time:
 *   1. every `blockingSpecs`/`advisorySpecs` path actually exists on disk;
 *   2. every `REQUIRED_FUNCTIONAL_E2E` blockingSpecs path lives in the required (non-advisory) E2E
 *      lane, not in tests/e2e/deep/ or tests/unit/ — required-lane suitability, not spec content;
 *   3. every FEATURE_CATALOG riskLevel:'high' flag has an explicit `rationale` whenever its
 *      disposition is weaker than REQUIRED_FUNCTIONAL_E2E, so a high-risk gap can never be silent.
 *
 * What this script deliberately does NOT do: parse spec file contents to prove a blockingSpecs
 * entry actually asserts the claimed flag's behavior. `blockingSpecs` are declared required
 * evidence paths whose EXISTENCE and LANE are machine-checked here; their assertion QUALITY is
 * proven by the spec itself plus human/bot review, not by a second AST/regex governance layer.
 *
 * Exhaustiveness itself (every flag present exactly once, no retired flags left behind) is already
 * enforced by TypeScript at the registry's own `satisfies` position — this script does not repeat it.
 *
 * Usage: pnpm exec tsx scripts/check-feature-test-coverage.ts
 * Exit 0 = all checks pass; Exit 1 = drift found
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_CATALOG } from '../features/featureCatalog';
import { FEATURE_TEST_COVERAGE } from '../tests/e2e/config/featureTestCoverage';

const ROOT = join(import.meta.dirname, '..');

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

let errors = 0;
const warnings = 0;

console.log(bold('\n=== WorldScript Studio — Feature Test Coverage Authority Check ===\n'));

// ---------------------------------------------------------------------------
// 1. Every referenced spec path exists on disk
// ---------------------------------------------------------------------------

const missingSpecs: Array<{ flag: string; path: string; kind: 'blocking' | 'advisory' }> = [];

for (const [flag, coverage] of Object.entries(FEATURE_TEST_COVERAGE)) {
  for (const path of coverage.blockingSpecs) {
    if (!existsSync(join(ROOT, path))) {
      missingSpecs.push({ flag, path, kind: 'blocking' });
    }
  }
  for (const path of coverage.advisorySpecs ?? []) {
    if (!existsSync(join(ROOT, path))) {
      missingSpecs.push({ flag, path, kind: 'advisory' });
    }
  }
}

if (missingSpecs.length > 0) {
  console.log(red('CRITICAL — Referenced spec paths that do not exist on disk:'));
  for (const { flag, path, kind } of missingSpecs) {
    console.log(red(`  • ${flag} (${kind}): ${path}`));
    errors++;
  }
  console.log();
} else {
  console.log(
    green(`✓ All ${Object.keys(FEATURE_TEST_COVERAGE).length} flags' referenced spec paths exist.`),
  );
}

// ---------------------------------------------------------------------------
// 2. REQUIRED_FUNCTIONAL_E2E blockingSpecs must live in the required E2E lane
// ---------------------------------------------------------------------------

const wrongLaneSpecs: Array<{ flag: string; path: string }> = [];

for (const [flag, coverage] of Object.entries(FEATURE_TEST_COVERAGE)) {
  if (coverage.disposition !== 'REQUIRED_FUNCTIONAL_E2E') continue;
  for (const path of coverage.blockingSpecs) {
    const isRequiredE2ELane = path.startsWith('tests/e2e/') && !path.startsWith('tests/e2e/deep/');
    if (!isRequiredE2ELane) {
      wrongLaneSpecs.push({ flag, path });
    }
  }
}

if (wrongLaneSpecs.length > 0) {
  console.log(
    red(
      'CRITICAL — REQUIRED_FUNCTIONAL_E2E blockingSpecs outside the required (non-advisory) E2E lane:',
    ),
  );
  for (const { flag, path } of wrongLaneSpecs) {
    console.log(
      red(`  • ${flag}: ${path} (must be tests/e2e/*.spec.ts, not tests/e2e/deep/ or tests/unit/)`),
    );
    errors++;
  }
  console.log();
} else {
  console.log(
    green('✓ Every REQUIRED_FUNCTIONAL_E2E blockingSpecs path is in the required E2E lane.'),
  );
}

// ---------------------------------------------------------------------------
// 3. High-risk flags cannot silently be weaker than REQUIRED_FUNCTIONAL_E2E without a rationale
// ---------------------------------------------------------------------------

const STRONG_DISPOSITIONS = new Set(['REQUIRED_FUNCTIONAL_E2E']);
const silentHighRiskGaps: string[] = [];

for (const entry of FEATURE_CATALOG) {
  if (entry.riskLevel !== 'high') continue;
  const coverage = FEATURE_TEST_COVERAGE[entry.flagKey];
  if (STRONG_DISPOSITIONS.has(coverage.disposition)) continue;
  if (!coverage.rationale || coverage.rationale.trim().length === 0) {
    silentHighRiskGaps.push(entry.flagKey);
  }
}

if (silentHighRiskGaps.length > 0) {
  console.log(
    red(
      'CRITICAL — riskLevel:high flags with a disposition weaker than REQUIRED_FUNCTIONAL_E2E and no rationale:',
    ),
  );
  for (const flag of silentHighRiskGaps) {
    console.log(red(`  • ${flag}`));
    errors++;
  }
  console.log();
} else {
  console.log(
    green('✓ Every high-risk flag either has functional E2E coverage or an explicit rationale.'),
  );
}

// ---------------------------------------------------------------------------
// 4. Every FEATURE_CATALOG flag has a coverage entry (belt-and-suspenders alongside the compiler)
// ---------------------------------------------------------------------------

const catalogFlags = new Set<string>(FEATURE_CATALOG.map((e) => e.flagKey));
const coverageFlags = new Set(Object.keys(FEATURE_TEST_COVERAGE));
const missingFromCoverage = [...catalogFlags].filter((f) => !coverageFlags.has(f));
const extraInCoverage = [...coverageFlags].filter((f) => !catalogFlags.has(f));

if (missingFromCoverage.length > 0 || extraInCoverage.length > 0) {
  // QNBS-v3: unreachable under normal `tsx` execution (already a compile error at the registry's `satisfies` position) -- defense-in-depth for transpiled/type-stripped invocations.
  console.log(
    red('CRITICAL — FEATURE_CATALOG and FEATURE_TEST_COVERAGE disagree on the flag set:'),
  );
  for (const f of missingFromCoverage)
    console.log(red(`  • ${f}: missing from FEATURE_TEST_COVERAGE`));
  for (const f of extraInCoverage)
    console.log(red(`  • ${f}: retired but still in FEATURE_TEST_COVERAGE`));
  errors++;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + bold('=== Summary ==='));
console.log(`Total flags: ${Object.keys(FEATURE_TEST_COVERAGE).length}`);
console.log(`Critical errors: ${errors > 0 ? red(String(errors)) : green('0')}`);
console.log(`Warnings: ${warnings > 0 ? yellow(String(warnings)) : green('0')}`);

if (errors > 0) {
  console.log(red('\n✗ Feature test coverage check FAILED'));
  process.exit(1);
} else {
  console.log(green('\n✓ Feature test coverage check passed'));
  process.exit(0);
}
