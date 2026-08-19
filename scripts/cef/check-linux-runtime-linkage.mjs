#!/usr/bin/env node
/**
 * CEF Linux runtime *linkage* check (docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md §44.3) —
 * the specific gap docs/architecture/native-readiness.md and
 * docs/cef/knowledge/linux-runtime-notes.md have both flagged as open since Wave 2's
 * first spike: check-linux-runtime-deps.mjs only confirms a *package* is installed via
 * dpkg, never that the *actual shipped* .so files this build produced can resolve their
 * real runtime dependencies. A package can be installed and still not satisfy a binary's
 * exact SONAME/version requirement; dpkg presence alone doesn't prove that.
 *
 * Runs `ldd` against the real, already-built worldscript_host executable and the real
 * libcef.so CEF shipped into the same output directory (COPY_FILES, apps/desktop-cef/
 * CMakeLists.txt) — not a hypothetical package list. Reports any `=> not found` line as
 * a genuine unresolved runtime dependency.
 *
 * Deliberately non-fatal by default, matching check-linux-runtime-deps.mjs's own
 * reasoning: an honest inventory data point, not a gate on a specific distro's package
 * set, until a real compatibility floor (§44.1) has been proven. Pass --strict once it
 * has.
 *
 * Run: node scripts/cef/check-linux-runtime-linkage.mjs <build-output-dir> [--strict]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [outputDir] = process.argv.slice(2);
const strict = process.argv.includes('--strict');

if (!outputDir) {
  console.error(
    '[check-linux-linkage] Usage: node scripts/cef/check-linux-runtime-linkage.mjs <build-output-dir> [--strict]',
  );
  process.exit(1);
}

// QNBS-v3: the two artifacts whose actual runtime linkage matters most — the host executable itself, and libcef.so, CEF's own largest and most dependency-heavy shared library (apps/desktop-cef/CMakeLists.txt's CEF_BINARY_FILES COPY_FILES step puts both in the same output directory).
const TARGETS = ['worldscript_host', 'libcef.so'];

/** @param {string} target */
function checkLinkage(target) {
  const targetPath = path.join(outputDir, target);
  let out;
  try {
    // QNBS-v3: ldd's own exit code is 0 even when a dependency is unresolved (it prints "=> not found" and still exits cleanly) — the unresolved-dependency signal is in stdout text, not the process exit code, so it must be parsed rather than trusted from execFileSync alone.
    out = execFileSync('ldd', [targetPath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (err) {
    // A genuinely non-dynamic-executable or missing file is itself a real finding, not a script bug.
    return {
      target,
      ok: false,
      notFound: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const notFound = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('=> not found') || /^\S+\s+not found/.test(line));
  return { target, ok: notFound.length === 0, notFound, error: null };
}

const results = TARGETS.map(checkLinkage);

console.log(
  '[check-linux-linkage] CEF Linux runtime *linkage* check (ldd against shipped .so files):',
);
for (const { target, ok, notFound, error } of results) {
  if (error) {
    console.log(`  ✗ ${target} — could not run ldd: ${error}`);
    continue;
  }
  console.log(
    `  ${ok ? '✓' : '✗'} ${target}${ok ? '' : ` — ${notFound.length} unresolved dependency line(s):`}`,
  );
  for (const line of notFound) {
    console.log(`      ${line}`);
  }
}

const anyFailed = results.some((r) => r.error || !r.ok);
if (anyFailed) {
  console.log('\n[check-linux-linkage] One or more targets have unresolved runtime dependencies.');
} else {
  console.log(
    `\n[check-linux-linkage] All ${results.length} target(s) fully resolved on this runner.`,
  );
}

if (strict && anyFailed) {
  console.error(
    '[check-linux-linkage] --strict requested and unresolved dependencies found — failing.',
  );
  process.exit(1);
}
