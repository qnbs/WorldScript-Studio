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
import { isDirectExecution, resolveModuleRoot } from './lib/cli-entrypoint.mjs';
import { evaluateBaseline } from './lib/ratchet-baseline.mjs';
import { collectTrackedSourceFiles, scanSuppressionFiles } from './suppression-scanner.mjs';

// QNBS-v3 (Sourcery + CodeAnt, PR #823): a plain path.dirname(fileURLToPath(...)) does not resolve symlinks — under `node --preserve-symlinks-main`, a symlink living outside the repository would make `root` (and therefore the scan corpus, baseline path, and reports directory) resolve beside the symlink instead of the real checkout. `resolveModuleRoot` (shared with audit-tokens.mjs) fixes this via fs.realpathSync.
export const root = resolveModuleRoot(import.meta.url);

/**
 * QNBS-v3 (#447; hardened after CodeAnt/Codex/CodeRabbit, PR #823): pure decision for `--update`
 * — never writes a file or touches process.exit, so it's exercised directly by tests.
 * `existingBaseline` is `null` on first-time baseline creation (always allowed). Otherwise, only a
 * STALE_HIGH_BASELINE verdict (a real improvement to bank) or EXACT_MATCH (a no-op) may write —
 * REGRESSION, MALFORMED_BASELINE, and MALFORMED_AUDIT all refuse. The original version refused only
 * REGRESSION, so a malformed baseline (or a malformed live scan) would fall through to a silent
 * overwrite instead of failing closed — exactly the "don't trust corrupted data" gap this whole
 * ratchet exists to close everywhere else.
 */
export function decideUpdateAction(current, existingBaseline) {
  if (existingBaseline) {
    const verdict = evaluateBaseline(current, {
      total: existingBaseline.total,
      summary: existingBaseline.byRule,
    });
    if (!verdict.ok && verdict.reason !== 'STALE_HIGH_BASELINE') {
      const detail = verdict.detail ? `: ${verdict.detail}` : '';
      return {
        action: 'REFUSE',
        message: `--update refused — ${verdict.reason}${detail}. Fix the underlying data first; --update only ever ratchets down from a trustworthy baseline and a trustworthy scan.`,
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

/**
 * QNBS-v3 (chatgpt-codex-connector, PR #823): the earlier re-read-before-write guard only
 * narrowed the concurrent-`--update` race, it didn't close it — two processes can each pass the
 * re-read check before either writes. This makes the whole read-decide-write sequence exclusive
 * via a lock file created with the `wx` flag, which Node/the OS guarantee is atomic (fails with
 * EEXIST if another process already holds it) — a real mutual-exclusion primitive, not a narrowed
 * window. A stale lock left by a crashed prior run must be removed manually; this is a rarely
 * invoked, human/CI-triggered CLI command, not a long-running service, so that residual is
 * accepted rather than adding lock-staleness heuristics that would reintroduce their own race.
 */
export function withUpdateLock(baselinePath, fn) {
  const lockPath = `${baselinePath}.lock`;
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(
        `another --update is already in progress (${lockPath} exists) — re-run once it finishes, or remove the lock file manually if a previous run crashed`,
      );
    }
    throw err;
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lockPath);
  }
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

  if (process.argv.includes('--update')) {
    // QNBS-v3 (chatgpt-codex-connector, PR #823): the whole read-decide-write sequence runs inside the lock, not just a re-check before the write — see withUpdateLock's own comment for why a re-check alone still leaves a real TOCTOU gap between two concurrent --update invocations.
    // QNBS-v3: process.exit() must not be called from inside the locked callback — it terminates immediately without running withUpdateLock's `finally`, which would leak the lock file on every REFUSE and permanently block all future --update runs. The callback returns a result instead; exiting happens after withUpdateLock has already released the lock.
    let result;
    try {
      result = withUpdateLock(baselinePath, () => {
        const existingBaseline = loadExistingBaseline(baselinePath);
        const decision = decideUpdateAction(current, existingBaseline);
        if (decision.action === 'REFUSE') return decision;
        fs.writeFileSync(baselinePath, `${JSON.stringify(decision.baseline, null, 2)}\n`);
        return decision;
      });
    } catch (err) {
      console.error(`[suppressions] ${err.message}`);
      process.exit(1);
    }
    if (result.action === 'REFUSE') {
      console.error(`[suppressions] ${result.message}`);
      process.exit(1);
    }
    console.log(`[suppressions] baseline updated → ${total} total across ${files.length} files`);
    process.exit(0);
  }

  const existingBaseline = loadExistingBaseline(baselinePath);
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
