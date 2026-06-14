#!/usr/bin/env node
/**
 * Keeps README.md metrics (test-file count, i18n key count, test-case count) in sync
 * with the source of truth so they cannot silently drift.
 *
 *  - test-file count  → .{test,spec}.{ts,tsx} under the vitest.config.ts include roots
 *                       (tests/, components/, per-package tests dirs), excluding tests/e2e/ — same
 *                       domain as numTotalTests so the two metrics stay consistent
 *  - i18n key count   → leaf-count over locales/en/*.json (EN is the canonical key set)
 *  - test-case count  → numTotalTests from test-results.json when present (CI / after a JSON run);
 *                       otherwise the value currently in README is preserved (idempotent locally).
 *
 * Run via predev/prebuild — idempotent if already aligned (a second run produces no diff).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// QNBS-v3: generic digit token — tolerates thin-space / nbsp / narrow-nbsp / comma separators
// (README prose uses "2 594", "5 475") so the regex matches both old and freshly-written forms.
const NUM = '[\\d\\u00A0\\u202F\\u2009\\u2007 ,]+';

// QNBS-v3: count only the files Vitest actually runs (see vitest.config.ts include/exclude),
// so the file metric shares the same domain as numTotalTests — Playwright E2E under
// tests/e2e/ is excluded (CodeAnt #139: unit-test count must not be paired with E2E specs).
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const E2E_DIR = join(root, 'tests', 'e2e');

/** Recursively count Vitest test files under `dir`, skipping node_modules/.git/dist and tests/e2e. */
function countTestFiles(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === E2E_DIR) continue; // vitest.config.ts exclude: ['tests/e2e/**']
      count += countTestFiles(full);
    } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
      count += 1;
    }
  }
  return count;
}

/** Count leaf values in a nested JSON object. */
function countLeaves(obj) {
  return Object.values(obj).reduce(
    (acc, v) => acc + (v && typeof v === 'object' ? countLeaves(v) : 1),
    0,
  );
}

function getTestFileCount() {
  // Mirror the three vitest.config.ts include roots; tests/e2e is excluded inside countTestFiles.
  return (
    countTestFiles(join(root, 'tests')) +
    countTestFiles(join(root, 'components')) +
    readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .reduce((acc, pkg) => acc + countTestFiles(join(root, 'packages', pkg.name, 'tests')), 0)
  );
}

function getKeyCount() {
  const localeDir = join(root, 'locales', 'en');
  let total = 0;
  for (const file of readdirSync(localeDir)) {
    if (!file.endsWith('.json')) continue;
    total += countLeaves(JSON.parse(readFileSync(join(localeDir, file), 'utf8')));
  }
  return total;
}

/** numTotalTests from test-results.json, else the current README badge value (preserve). */
function getTestCaseCount(readme) {
  const resultsPath = join(root, 'test-results.json');
  if (existsSync(resultsPath) && statSync(resultsPath).isFile()) {
    try {
      const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
      if (typeof results.numTotalTests === 'number' && results.numTotalTests > 0) {
        return results.numTotalTests;
      }
    } catch {
      // fall through to README value
    }
  }
  const m = readme.match(/Tests-(\d+)%2B_%2F_\d+_files/);
  return m ? Number(m[1]) : null;
}

const readmePath = join(root, 'README.md');
let readme = readFileSync(readmePath, 'utf8');
const original = readme;

const fileCount = getTestFileCount();
const keyCount = getKeyCount();
const testCount = getTestCaseCount(readme);

// --- Badges (shields.io URL + alt text) -------------------------------------
readme = readme.replace(/i18n-11_locales-\d+_keys/g, `i18n-11_locales-${keyCount}_keys`);
readme = readme.replace(/(11 locales — )\d+( keys)/g, `$1${keyCount}$2`);
if (testCount != null) {
  readme = readme.replace(
    /Tests-\d+%2B_%2F_\d+_files/g,
    `Tests-${testCount}%2B_%2F_${fileCount}_files`,
  );
  readme = readme.replace(
    /(alt=")\d+\+ tests \/ \d+ files(")/g,
    `$1${testCount}+ tests / ${fileCount} files$2`,
  );
}

// --- Prose occurrences ------------------------------------------------------
// Line ~352: "Shipped UI locales with **2 594 i18n keys**"
readme = readme.replace(
  new RegExp(`(Shipped UI locales with \\*\\*)${NUM}( i18n keys\\*\\*)`),
  `$1${keyCount}$2`,
);
// Line ~453: "| 2 594 keys × 11 locales" — keep the table-cell leading space.
readme = readme.replace(new RegExp(`(\\| )${NUM}(keys × 11 locales)`), `$1${keyCount} $2`);
// Line ~652: "- i18n: **2 594 keys × 11 locales**" — non-table bold summary bullet.
readme = readme.replace(
  new RegExp(`(i18n: \\*\\*)${NUM}(keys × 11 locales\\*\\*)`),
  `$1${keyCount} $2`,
);
if (testCount != null) {
  // Line ~454: "Vitest 4.x (5 475+ tests / 449 files)"
  readme = readme.replace(
    new RegExp(`(Vitest 4\\.x \\()${NUM}\\+ tests / ${NUM}files\\)`),
    `$1${testCount}+ tests / ${fileCount} files)`,
  );
  // Line ~491: "Vitest unit tests (5 475+ tests, 449 files)"
  readme = readme.replace(
    new RegExp(`(Vitest unit tests \\()${NUM}\\+ tests, ${NUM}files\\)`),
    `$1${testCount}+ tests, ${fileCount} files)`,
  );
  // Line ~650: "**5 475+ unit tests** across **449 test files**"
  readme = readme.replace(
    new RegExp(`\\*\\*${NUM}\\+ unit tests\\*\\* across \\*\\*${NUM}test files\\*\\*`),
    `**${testCount}+ unit tests** across **${fileCount} test files**`,
  );
}

// QNBS-v3: drift guard (CodeAnt #139) — after rewriting, every metric occurrence MUST equal the
// computed value. Catches any phrasing a targeted replacement above missed, instead of silently
// leaving a stale "2 594". Value-based, not hard-coded, so it never goes stale itself.
// Digit-anchored token for the guard so it only matches genuine numeric metrics
// (NUM alone can match a lone separator/space, e.g. an unrelated " files" in prose).
const NUM_D = '\\d[\\d\\u00A0\\u202F\\u2009\\u2007 ,]*';
const toInt = (s) => Number(s.replace(/[^\d]/g, ''));
const drift = [];
const assertAll = (label, regex, expected) => {
  if (expected == null) return;
  for (const m of readme.matchAll(regex)) {
    if (toInt(m[1]) !== expected)
      drift.push(`${label}: found "${m[1].trim()}", expected ${expected}`);
  }
};
assertAll('i18n keys (× 11 locales)', new RegExp(`(${NUM_D})keys × 11 locales`, 'g'), keyCount);
assertAll('i18n keys (bold)', new RegExp(`\\*\\*(${NUM_D})i18n keys\\*\\*`, 'g'), keyCount);
assertAll('test cases', new RegExp(`(${NUM_D})\\+ (?:unit )?tests\\b`, 'g'), testCount);
assertAll('test files', new RegExp(`(${NUM_D})(?:test )?files\\b`, 'g'), fileCount);
if (drift.length > 0) {
  process.stderr.write(
    `[sync-readme-metrics] DRIFT GUARD FAILED — a metric occurrence was not synced:\n${drift
      .map((d) => `  - ${d}`)
      .join('\n')}\nAdd a replacement rule for the missed phrasing.\n`,
  );
  process.exit(1);
}

if (readme !== original) {
  writeFileSync(readmePath, readme);
  process.stdout.write(
    `[sync-readme-metrics] README.md → ${fileCount} test files, ${keyCount} i18n keys` +
      (testCount != null ? `, ${testCount}+ tests\n` : ` (test-case count unchanged)\n`),
  );
} else {
  process.stdout.write('[sync-readme-metrics] README.md already in sync — no changes.\n');
}
