#!/usr/bin/env tsx

/**
 * Feature Parity Audit Script
 * QNBS-v3: Validates that every flag in featureFlagsSlice is consistent across:
 *   1. Slice definition (FeatureFlagsState interface + defaultFeatureFlagsState)
 *   2. i18n locale keys (locales/en/settings.json)
 *   3. UI toggle list (components/settings/FeatureFlagsSection.tsx)
 *   4. handleSettingChange switch (hooks/useSettingsView.ts)
 *   5. Runtime gate (at least one non-test file reads the flag)
 *
 * Usage:  pnpm exec tsx scripts/audit-feature-parity.ts
 * Exit 0 = all checks pass; Exit 1 = drifts found
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, '..');

const SLICE_FILE = join(ROOT, 'features/featureFlags/featureFlagsSlice.ts');
const LOCALE_FILE = join(ROOT, 'locales/en/settings.json');
const SECTION_FILE = join(ROOT, 'components/settings/FeatureFlagsSection.tsx');
const SETTINGS_HOOK = join(ROOT, 'hooks/useSettingsView.ts');

// Files/dirs excluded from runtime-gate grep (tests, type declarations, config)
const GREP_EXCLUDE = [
  '--exclude=*.test.ts',
  '--exclude=*.test.tsx',
  '--exclude=*.spec.ts',
  '--exclude=*.d.ts',
  '--exclude-dir=node_modules',
  '--exclude-dir=dist',
  '--exclude-dir=.git',
  '--exclude=featureFlagsSlice.ts',
  '--exclude=FeatureFlagsSection.tsx',
  '--exclude=useSettingsView.ts',
  '--exclude=featureCatalog.ts',
  '--exclude=audit-feature-parity.ts',
].join(' ');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

function grep(pattern: string, dir = ROOT): string {
  try {
    return execSync(`grep -rn ${GREP_EXCLUDE} -l "${pattern}" "${dir}" 2>/dev/null`, {
      encoding: 'utf-8',
    }).trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Step 1: Extract flags from slice
// ---------------------------------------------------------------------------

function extractFlagsFromSlice(src: string): string[] {
  const interfaceMatch = src.match(/export interface FeatureFlagsState \{([^}]+)\}/s);
  if (!interfaceMatch?.[1]) throw new Error('Could not parse FeatureFlagsState interface');
  return interfaceMatch[1]
    .split('\n')
    .map((line) => line.match(/^\s+(enable\w+)\s*:/)?.[1])
    .filter((f): f is string => f !== undefined);
}

// ---------------------------------------------------------------------------
// Step 2: Extract flags from defaultFeatureFlagsState
// ---------------------------------------------------------------------------

function extractDefaultsFromSlice(src: string): Set<string> {
  const defaultsMatch = src.match(/const defaultFeatureFlagsState[^=]*=\s*\{([^}]+)\}/s);
  if (!defaultsMatch?.[1]) throw new Error('Could not parse defaultFeatureFlagsState');
  return new Set(
    defaultsMatch[1]
      .split('\n')
      .map((line) => line.match(/^\s+(enable\w+)\s*:/)?.[1])
      .filter((f): f is string => f !== undefined),
  );
}

// ---------------------------------------------------------------------------
// Step 3: Extract flags from locale
// ---------------------------------------------------------------------------

function extractLocaleFlags(src: string): Set<string> {
  return new Set(
    [...src.matchAll(/"settings\.featureFlags\.(enable\w+)"/g)].map((m) => m[1] as string),
  );
}

// ---------------------------------------------------------------------------
// Step 4: Extract flags from FeatureFlagsSection.tsx
// ---------------------------------------------------------------------------

function extractSectionFlags(src: string): Set<string> {
  return new Set([...src.matchAll(/key:\s*['"`](enable\w+)['"`]/g)].map((m) => m[1] as string));
}

// ---------------------------------------------------------------------------
// Step 5: Extract flags from useSettingsView.ts switch
// ---------------------------------------------------------------------------

function extractHandlerFlags(src: string): Set<string> {
  return new Set([...src.matchAll(/case\s+['"`](enable\w+)['"`]\s*:/g)].map((m) => m[1] as string));
}

// ---------------------------------------------------------------------------
// Step 6: Check runtime consumption (grep across codebase)
// ---------------------------------------------------------------------------

function hasRuntimeConsumption(flag: string): boolean {
  const result = grep(flag);
  return result.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Main audit
// ---------------------------------------------------------------------------

const sliceSrc = read(SLICE_FILE);
const localeSrc = read(LOCALE_FILE);
const sectionSrc = read(SECTION_FILE);
const hookSrc = read(SETTINGS_HOOK);

const sliceFlags = extractFlagsFromSlice(sliceSrc);
const defaultFlags = extractDefaultsFromSlice(sliceSrc);
const localeFlags = extractLocaleFlags(localeSrc);
const sectionFlags = extractSectionFlags(sectionSrc);
const handlerFlags = extractHandlerFlags(hookSrc);

let errors = 0;
let warnings = 0;

console.log(bold('\n=== WorldScript Studio — Feature Parity Audit ===\n'));
console.log(`Found ${sliceFlags.length} flags in FeatureFlagsState\n`);

const rows: Array<{
  flag: string;
  inDefaults: boolean;
  inLocale: boolean;
  inSection: boolean;
  inHandler: boolean;
  hasRuntime: boolean;
}> = [];

for (const flag of sliceFlags) {
  const inDefaults = defaultFlags.has(flag);
  const inLocale = localeFlags.has(flag);
  const inSection = sectionFlags.has(flag);
  const inHandler = handlerFlags.has(flag);
  const hasRuntime = hasRuntimeConsumption(flag);
  rows.push({ flag, inDefaults, inLocale, inSection, inHandler, hasRuntime });
}

// Print table header
console.log(
  [
    'Flag'.padEnd(34),
    'Defaults'.padEnd(10),
    'i18n'.padEnd(8),
    'Section'.padEnd(10),
    'Handler'.padEnd(10),
    'Runtime',
  ].join(''),
);
console.log('─'.repeat(90));

for (const row of rows) {
  const check = (v: boolean) => (v ? green('✅') : red('❌'));
  const runtimeCheck = row.hasRuntime ? green('✅') : yellow('⚠️ ');

  const flagLabel = row.flag.padEnd(34);
  const line = [
    flagLabel,
    check(row.inDefaults).padEnd(18),
    check(row.inLocale).padEnd(16),
    check(row.inSection).padEnd(18),
    check(row.inHandler).padEnd(18),
    runtimeCheck,
  ].join('');

  console.log(line);

  // Count issues
  if (!row.inDefaults) errors++;
  if (!row.inLocale) errors++;
  if (!row.inSection) warnings++; // warning — dev-only flags may intentionally skip UI
  if (!row.inSection && row.inHandler) errors++; // handler without UI toggle is dead code
  if (row.inSection && !row.inHandler) errors++; // UI toggle with no handler = critical bug
  if (!row.hasRuntime) warnings++; // ghost flag
}

console.log('─'.repeat(90));

// Detailed findings
console.log('\n' + bold('=== Detailed Findings ===\n'));

// Critical: UI toggle but no handler
const missingHandlers = rows.filter((r) => r.inSection && !r.inHandler);
if (missingHandlers.length > 0) {
  console.log(red('CRITICAL — Toggles with no handler (silent noop):'));
  for (const r of missingHandlers) {
    console.log(red(`  • ${r.flag} — user toggle fires → logger.warn() → Redux NOT updated`));
    console.log(
      `    Fix: add case '${r.flag}': dispatch(featureFlagsActions.set${r.flag.charAt(0).toUpperCase() + r.flag.slice(1)}(Boolean(value))); break;`,
    );
    console.log(`    in hooks/useSettingsView.ts`);
  }
  console.log();
}

// Critical: no i18n key
const missingI18n = rows.filter((r) => !r.inLocale);
if (missingI18n.length > 0) {
  console.log(red('CRITICAL — Missing i18n keys (locales/en/settings.json):'));
  for (const r of missingI18n) {
    console.log(red(`  • "settings.featureFlags.${r.flag}": "..." missing`));
  }
  console.log();
}

// Critical: missing from defaultFeatureFlagsState
const missingDefaults = rows.filter((r) => !r.inDefaults);
if (missingDefaults.length > 0) {
  console.log(red('CRITICAL — Missing from defaultFeatureFlagsState:'));
  for (const r of missingDefaults) {
    console.log(red(`  • ${r.flag} has no default value`));
  }
  console.log();
}

// Warnings: flags without runtime consumption
const ghostFlags = rows.filter((r) => !r.hasRuntime);
if (ghostFlags.length > 0) {
  console.log(yellow('WARNING — Ghost flags (no production code reads them):'));
  for (const r of ghostFlags) {
    console.log(
      yellow(`  • ${r.flag} — defined in slice but not consumed by any service/component/hook`),
    );
  }
  console.log();
}

// Warnings: flags in section but not in handler
const noUiToggle = rows.filter((r) => !r.inSection);
if (noUiToggle.length > 0) {
  console.log(yellow('INFO — Flags with no UI toggle (Settings cannot change them):'));
  for (const r of noUiToggle) {
    console.log(yellow(`  • ${r.flag}`));
  }
  console.log();
}

// Summary
console.log(bold('=== Summary ==='));
console.log(`Total flags: ${sliceFlags.length}`);
console.log(`Critical errors: ${errors > 0 ? red(String(errors)) : green('0')}`);
console.log(`Warnings: ${warnings > 0 ? yellow(String(warnings)) : green('0')}`);

if (errors > 0) {
  console.log(red('\n✗ Audit FAILED — fix critical errors before shipping'));
  process.exit(1);
} else if (warnings > 0) {
  console.log(yellow('\n⚠ Audit passed with warnings'));
  process.exit(0);
} else {
  console.log(green('\n✓ Audit passed — all flags consistent'));
  process.exit(0);
}
