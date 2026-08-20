#!/usr/bin/env node
/**
 * Non-blocking: compares coverage/coverage-summary.json (produced by the CI quality job,
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
import coverageThresholds from './coverage-thresholds.json' with { type: 'json' };

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SUMMARY_PATH = join(root, 'coverage', 'coverage-summary.json');

// QNBS-v3: Vitest and this advisory report share one threshold source.
const THRESHOLDS = coverageThresholds;
const RATCHET_GAP = 2;

// QNBS-v3: every exit path is a `return`, never `process.exit(1)` — this is advisory-only, so a missing/malformed/all-clean summary must all fall through to the same non-blocking outcome.
function main() {
  if (!existsSync(SUMMARY_PATH)) {
    process.stdout.write(
      '[coverage-ratchet] No coverage/coverage-summary.json found — CI has not produced the summary yet. Skipping (non-blocking).\n',
    );
    return;
  }

  // QNBS-v3: a truncated/invalid summary must not violate the "always exits 0" contract this
  // script documents — catch parse failures the same way a missing file is already handled.
  let summary;
  try {
    summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
  } catch {
    process.stdout.write(
      '[coverage-ratchet] Could not parse coverage-summary.json — skipping (non-blocking).\n',
    );
    return;
  }
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
