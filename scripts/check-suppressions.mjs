#!/usr/bin/env node
/**
 * Suppression-debt ratchet gate (audit finding F-4).
 *
 * Counts `biome-ignore` directives across Git-tracked TS/TSX source files, grouped by rule, and
 * fails CI when any rule's count differs from its committed per-rule baseline in
 * `suppressions-baseline.json` (#447: a true monotonic per-rule ratchet — see
 * `scripts/lib/ratchet-baseline.mjs`). An aggregate-only comparison previously let one rule's
 * improvement finance another rule's regression as long as the total stayed unchanged.
 *
 * Run:    node scripts/check-suppressions.mjs            # gate (exit 1 on any per-rule mismatch)
 *         node scripts/check-suppressions.mjs --update   # ratchet the baseline to current counts
 *         node scripts/check-suppressions.mjs --details  # gate + per-file breakdown
 *
 * `--update` refuses to write a baseline that would raise any existing per-rule ceiling — a
 * regression must be fixed at the source (or accepted through a separately governed, explicit
 * exception edited directly into the baseline file), never through the routine ratchet-down
 * command.
 *
 * Writes a full per-rule breakdown to `reports/suppressions.json`.
 * With --details, also writes a per-file breakdown to `reports/suppressions-details.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from './lib/cli-entrypoint.mjs';
import { evaluateBaseline } from './lib/ratchet-baseline.mjs';
import { collectTrackedSourceFiles, scanSuppressionFiles } from './suppression-scanner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(__dirname, '..');

/**
 * QNBS-v3 (#447): pure decision for `--update` — never writes a file or touches process.exit, so
 * it's exercised directly by tests. `existingBaseline` is `null` on first-time baseline creation
 * (always allowed); otherwise a REGRESSION verdict against it refuses the write.
 */
export function decideUpdateAction(current, existingBaseline) {
  if (existingBaseline) {
    const verdict = evaluateBaseline(current, {
      total: existingBaseline.total,
      summary: existingBaseline.byRule,
    });
    if (verdict.reason === 'REGRESSION') {
      return {
        action: 'REFUSE',
        message:
          `--update refused — this would raise a per-rule ceiling: ${verdict.detail}. ` +
          'Remove the new suppression(s) or fix the root cause first; --update only ever ratchets down.',
      };
    }
  }
  return {
    action: 'WRITE',
    baseline: { total: current.total, byRule: current.summary },
  };
}

/**
 * QNBS-v3 (#447): pure gate decision, given the already-collected current counts and the parsed
 * baseline file (or null if none exists yet). Delegates to the shared `evaluateBaseline` ratchet
 * and only adds the human-readable remediation tip per failure reason.
 */
export function decideGateAction(current, existingBaseline) {
  const verdict = evaluateBaseline(
    current,
    existingBaseline && { total: existingBaseline.total, summary: existingBaseline.byRule },
  );
  if (verdict.ok) return { action: 'PASS' };

  let tip = '';
  if (verdict.reason === 'REGRESSION') {
    tip =
      'Remove the new suppression or fix the root cause; do not raise the baseline (ratchet-only).';
  } else if (verdict.reason === 'STALE_HIGH_BASELINE') {
    tip =
      'A per-rule count dropped below its baseline — run `node scripts/check-suppressions.mjs --update` ' +
      'to bank the improvement (this cannot also raise a different rule; see above).';
  } else if (verdict.reason === 'NO_BASELINE_VIOLATIONS_FOUND') {
    tip = 'No suppressions-baseline.json exists yet — run with --update to create it.';
  }
  return { action: 'FAIL', reason: verdict.reason, detail: verdict.detail, tip };
}

function loadExistingBaseline(baselinePath) {
  return fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
}

function main() {
  const files = collectTrackedSourceFiles({ root });
  const { total, byRule: sorted, byFile } = scanSuppressionFiles(files);
  const current = { total, summary: sorted };

  const reportsDir = path.join(root, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, 'suppressions.json'),
    `${JSON.stringify({ total, byRule: sorted, files: files.length, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );

  if (process.argv.includes('--details')) {
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
  const existingBaseline = loadExistingBaseline(baselinePath);

  if (process.argv.includes('--update')) {
    const decision = decideUpdateAction(current, existingBaseline);
    if (decision.action === 'REFUSE') {
      console.error(`[suppressions] ${decision.message}`);
      process.exit(1);
    }
    fs.writeFileSync(baselinePath, `${JSON.stringify(decision.baseline, null, 2)}\n`);
    console.log(`[suppressions] baseline updated → ${total} total across ${files.length} files`);
    process.exit(0);
  }

  console.log(`[suppressions] total ${total} across ${files.length} files`);
  for (const [rule, n] of Object.entries(sorted))
    console.log(`  ${n.toString().padStart(4)}  ${rule}`);

  const decision = decideGateAction(current, existingBaseline);
  if (decision.action === 'FAIL') {
    console.error(
      `\n[suppressions] FAIL — ${decision.reason}${decision.detail ? `: ${decision.detail}` : ''}`,
    );
    if (decision.tip) console.error(decision.tip);
    console.error(
      'Tip: run `node scripts/check-suppressions.mjs --details` for a per-file breakdown.',
    );
    process.exit(1);
  }
  console.log('[suppressions] OK');
}

// QNBS-v3: only run the CLI when this file is executed directly — importing it (e.g. from a test file, for the exported pure helpers) must not trigger a report write or process.exit.
if (isDirectExecution(process.argv[1], import.meta.url)) {
  main();
}
