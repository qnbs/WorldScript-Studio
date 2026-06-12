#!/usr/bin/env node
/**
 * Suppression-debt ratchet gate (audit finding F-4).
 *
 * Counts `biome-ignore` directives across the TS/TSX source tree, grouped by rule, and fails CI
 * when the total exceeds the committed baseline in `suppressions-baseline.json`. The baseline may
 * only ever DECREASE — this stops the suppression count (162x noExplicitAny at baseline time) from
 * silently growing the way it did Mar→Jun 2026 (137 → 186). No gate previously prevented that.
 *
 * Run:    node scripts/check-suppressions.mjs            # gate (exit 1 if total > baseline)
 *         node scripts/check-suppressions.mjs --update   # rewrite baseline to current (after abatement)
 *         node scripts/check-suppressions.mjs --details  # gate + per-file breakdown
 *
 * Writes a full per-rule breakdown to `reports/suppressions.json`.
 * With --details, also writes a per-file breakdown to `reports/suppressions-details.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Directories that never contain first-party source we want to count.
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-storybook',
  'storybook-static',
  'coverage',
  '.git',
  'reports',
  'graphify-out',
  '.codegraph',
  'playwright-report',
  'test-results',
  'src-tauri', // Rust + target/, no .ts
]);

const SRC_EXT = new Set(['.ts', '.tsx']);
const BIOME_IGNORE = /biome-ignore(?:-start|-end)?\s+([a-zA-Z][\w/]*)/;

/** Recursively collect first-party .ts/.tsx files. */
function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), out);
    } else if (SRC_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = collect(root, []);
/** @type {Record<string, number>} */
const byRule = {};
/** @type {Record<string, Record<string, number>>} */
const byFile = {};
let total = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes('biome-ignore')) continue;
    const m = line.match(BIOME_IGNORE);
    const rule = m ? m[1] : 'unknown';
    byRule[rule] = (byRule[rule] ?? 0) + 1;
    total++;
    if (!byFile[file]) byFile[file] = {};
    byFile[file][rule] = (byFile[file][rule] ?? 0) + 1;
  }
}

const sorted = Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1]));
const report = {
  total,
  byRule: sorted,
  files: files.length,
  generatedAt: new Date().toISOString(),
};
const reportsDir = path.join(root, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
  path.join(reportsDir, 'suppressions.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

const showDetails = process.argv.includes('--details');
if (showDetails) {
  const details = Object.entries(byFile)
    .filter(([, rules]) => Object.keys(rules).length > 0)
    .sort((a, b) => {
      const countA = Object.values(a[1]).reduce((sum, n) => sum + n, 0);
      const countB = Object.values(b[1]).reduce((sum, n) => sum + n, 0);
      return countB - countA;
    })
    .map(([file, rules]) => ({ file, rules }));
  fs.writeFileSync(
    path.join(reportsDir, 'suppressions-details.json'),
    `${JSON.stringify({ total, files: details.length, details, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log('\n[suppressions] per-file breakdown:');
  for (const { file, rules } of details.slice(0, 20)) {
    const fileTotal = Object.values(rules).reduce((sum, n) => sum + n, 0);
    console.log(`  ${fileTotal}  ${path.relative(root, file)}`);
    for (const [rule, n] of Object.entries(rules).sort((a, b) => b[1] - a[1])) {
      console.log(`       ${n}  ${rule}`);
    }
  }
  if (details.length > 20) {
    console.log(
      `  ... and ${details.length - 20} more files (see reports/suppressions-details.json)`,
    );
  }
}

const baselinePath = path.join(root, 'suppressions-baseline.json');

if (process.argv.includes('--update')) {
  fs.writeFileSync(baselinePath, `${JSON.stringify({ total, byRule: sorted }, null, 2)}\n`);
  console.log(`[suppressions] baseline updated → ${total} total across ${files.length} files`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(
    '[suppressions] missing suppressions-baseline.json — run with --update to create it.',
  );
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
console.log(
  `[suppressions] total ${total} (baseline ${baseline.total}) across ${files.length} files`,
);
for (const [rule, n] of Object.entries(sorted))
  console.log(`  ${n.toString().padStart(4)}  ${rule}`);

if (total > baseline.total) {
  console.error(
    `\n[suppressions] FAIL — ${total} > baseline ${baseline.total} (+${total - baseline.total}). ` +
      'Remove a suppression or fix the root cause; do not raise the baseline (ratchet-only).',
  );
  console.error(
    'Tip: run `node scripts/check-suppressions.mjs --details` for a per-file breakdown.',
  );
  process.exit(1);
}
if (total < baseline.total) {
  console.log(
    `[suppressions] ${baseline.total - total} below baseline — run \`node scripts/check-suppressions.mjs --update\` to ratchet it down.`,
  );
}
console.log('[suppressions] OK');
