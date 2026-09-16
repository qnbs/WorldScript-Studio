#!/usr/bin/env tsx

/**
 * Feature Test Coverage Authority Check (#709)
 * QNBS-v3: Validates what `tests/e2e/config/featureTestCoverage.ts`'s own
 * `satisfies Record<keyof FeatureFlagsState, FeatureTestCoverage>` cannot prove at compile time:
 *   1. every `blockingSpecs`/`advisorySpecs` path actually exists on disk;
 *   2. `criticalCombinations` (test-matrix.ts) has a real consumer, not just its own definition;
 *   3. every FEATURE_CATALOG riskLevel:'high' flag has an explicit `rationale` whenever its
 *      disposition is weaker than REQUIRED_FUNCTIONAL_E2E, so a high-risk gap can never be silent.
 *
 * Exhaustiveness itself (every flag present exactly once, no retired flags left behind) is already
 * enforced by TypeScript at the registry's own `satisfies` position — this script does not repeat it.
 *
 * Usage: pnpm exec tsx scripts/check-feature-test-coverage.ts
 * Exit 0 = all checks pass; Exit 1 = drift found
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_CATALOG } from '../features/featureCatalog';
import { FEATURE_TEST_COVERAGE } from '../tests/e2e/config/featureTestCoverage';
import { criticalCombinations } from '../tests/e2e/config/test-matrix';

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
// 2. criticalCombinations has a real consumer outside its own definition file
// ---------------------------------------------------------------------------

function hasRealConsumer(symbol: string, definitionFile: string): boolean {
  try {
    const result = execFileSync(
      'git',
      ['-C', ROOT, 'grep', '-I', '-l', '-w', '--', symbol, '--', 'tests/e2e'],
      { encoding: 'utf-8' },
    );
    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .some((path) => !path.endsWith(definitionFile));
  } catch {
    return false;
  }
}

if (!hasRealConsumer('criticalCombinations', 'tests/e2e/config/test-matrix.ts')) {
  console.log(
    red(
      'CRITICAL — criticalCombinations is declared in test-matrix.ts but has no consumer outside its own definition (dead metadata).',
    ),
  );
  errors++;
} else {
  console.log(
    green(`✓ criticalCombinations (${criticalCombinations.length} combos) has a real consumer.`),
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
