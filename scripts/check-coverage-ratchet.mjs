#!/usr/bin/env node
/**
 * Non-blocking: compares coverage/coverage-summary.json (produced by `pnpm run test:coverage`,
 * the json-summary reporter in vitest.config.ts) against the configured coverage thresholds, and
 * prints a suggestion when a metric sits comfortably above its threshold. The ratchet-up decision
 * stays with the maintainer (vitest.config.ts's own comment documents a "3 consecutive green runs,
 * max 5 points/quarter" rule) — this script only makes the opportunity visible instead of it
 * quietly rotting, the way the threshold history shows it has before.
 *
 * Run: node scripts/check-coverage-ratchet.mjs
 * Always exits 0 — never gates CI; wire it as a non-blocking informational step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SUMMARY_PATH = join(root, 'coverage', 'coverage-summary.json');

// QNBS-v3: mirrors vitest.config.ts's `coverage.thresholds` — that file isn't a plain-data module
// (it's a defineConfig() call), so this can't import it directly. Keep both in sync by hand; a
// mismatch here only makes a suggestion's "vs. threshold" number wrong, it can't mask a real
// coverage regression (vitest.config.ts's own thresholds still gate the actual build).
const THRESHOLDS = { lines: 74, functions: 67, branches: 60, statements: 72 };
const RATCHET_GAP = 2;

function main() {
  if (!existsSync(SUMMARY_PATH)) {
    process.stdout.write(
      '[coverage-ratchet] No coverage/coverage-summary.json found — run `pnpm run test:coverage` first. Skipping (non-blocking).\n',
    );
    return;
  }

  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
  const total = summary.total;
  if (!total) {
    process.stdout.write(
      '[coverage-ratchet] coverage-summary.json has no "total" field — skipping.\n',
    );
    return;
  }

  const suggestions = [];
  for (const [metric, threshold] of Object.entries(THRESHOLDS)) {
    const pct = total[metric]?.pct;
    if (typeof pct !== 'number') continue;
    if (pct - threshold >= RATCHET_GAP) {
      suggestions.push(
        `${metric} ${pct.toFixed(2)} vs. threshold ${threshold} → consider raising to ${Math.floor(pct) - 1}`,
      );
    }
  }

  if (suggestions.length === 0) {
    process.stdout.write(
      `[coverage-ratchet] No threshold has ${RATCHET_GAP}+ points of headroom — nothing to ratchet yet.\n`,
    );
    return;
  }

  process.stdout.write(
    `[coverage-ratchet] Ratchet fällig — see docs/COVERAGE-POLICY.md before raising:\n${suggestions
      .map((s) => `  - ${s}`)
      .join('\n')}\n`,
  );
}

main();
