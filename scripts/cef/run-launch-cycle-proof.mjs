#!/usr/bin/env node
/**
 * Repeated start/close cycle proof for the Wave 2 CEF host (ADR-0020, roadmap
 * §3142/§61.1.1 CI-enforceable harness checks).
 *
 * Launches the built worldscript_host N times against a real URL, sends SIGTERM
 * after a startup grace period, and verifies a clean process tree after a shutdown
 * grace period — per the documented finding that CEF's shutdown is not instantaneous
 * (docs/cef/knowledge/subprocess-and-shutdown.md): an immediate post-signal check is
 * a false positive, not evidence of a hang.
 *
 * Each cycle must independently show two proofs, not just "at least one cycle across
 * the whole run" (a real review finding — masking a later cycle's failure behind an
 * earlier success would make the proof meaningless):
 *   - FFI boundary: apps/desktop-cef/src/worldscript_handler.cpp's OnAfterCreated
 *     calls into rust-core deterministically, regardless of page content.
 *   - Real rendering: the page's title must be exactly "WorldScript Studio" — a CEF
 *     error page (bad bundle, load failure) would not produce that specific title,
 *     so this catches "CEF started but the app didn't actually render" failures the
 *     FFI proof alone cannot.
 *
 * Run: node scripts/cef/run-launch-cycle-proof.mjs <binary-path> <url> [--cycles N]
 */
import { execFileSync, spawn } from 'node:child_process';

const [binaryPath, url] = process.argv.slice(2);

const cyclesArgIdx = process.argv.indexOf('--cycles');
// QNBS-v3: distinguishes "flag absent" (default 3) from "flag present but no value" (e.g. trailing --cycles) — a naive undefined-check would silently default the latter too, same footgun class as fetch-cef-sdk.mjs's --cache-dir.
const cyclesArg = cyclesArgIdx !== -1 ? process.argv[cyclesArgIdx + 1] : undefined;
const cycles = cyclesArgIdx === -1 ? 3 : Number(cyclesArg);

const STARTUP_GRACE_MS = 4000;
const SHUTDOWN_GRACE_MS = 6000;
const FFI_PROOF_LINE = 'rust_core ping = 424242';
const EXPECTED_TITLE_LINE = 'title = WorldScript Studio';

if (!binaryPath || !url) {
  console.error(
    '[launch-cycle-proof] Usage: node scripts/cef/run-launch-cycle-proof.mjs <binary-path> <url> [--cycles N]',
  );
  process.exit(1);
}

// QNBS-v3: Number() accepts Infinity/NaN/fractional/non-positive values unvalidated — CodeAnt review finding on PR #388 (an unbounded or skipped loop from a malformed --cycles).
if (!Number.isInteger(cycles) || cycles <= 0) {
  console.error(`[launch-cycle-proof] --cycles must be a positive integer, got: ${cyclesArg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processTreeAlive() {
  try {
    // QNBS-v3: anchored to the start of the command line — xvfb-run's own wrapper process also carries binaryPath as an argument it forwards, so an unanchored match false-flags it as a leaked worldscript_host.
    const out = execFileSync('pgrep', ['-f', `^${binaryPath}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const remaining = out
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((pid) => pid !== process.pid);
    return remaining.length > 0;
  } catch {
    return false; // pgrep exits 1 when nothing matches — that's the clean state.
  }
}

function logStderr(index, stderr) {
  if (stderr) console.error(`[launch-cycle-proof] Cycle ${index + 1} stderr:\n${stderr}`);
}

async function runCycle(index) {
  console.log(`[launch-cycle-proof] Cycle ${index + 1}/${cycles}: launching…`);
  const child = spawn(binaryPath, [`--url=${url}`], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );

  // QNBS-v3: races against the startup grace period so an immediate crash is caught here, distinct from a deliberate SIGTERM-driven exit later — Qodo review finding on PR #388 ("crashed cycles count clean").
  const earlyExit = await Promise.race([exited, sleep(STARTUP_GRACE_MS).then(() => null)]);
  if (earlyExit) {
    logStderr(index, stderr);
    throw new Error(
      `Cycle ${index + 1}: exited during startup (code=${earlyExit.code}, signal=${earlyExit.signal}) instead of staying up — likely a crash, not a deliberate shutdown.`,
    );
  }

  child.kill('SIGTERM');
  const shutdownResult = await Promise.race([exited, sleep(SHUTDOWN_GRACE_MS).then(() => null)]);
  if (!shutdownResult) {
    logStderr(index, stderr);
    throw new Error(`Cycle ${index + 1}: process did not exit within the shutdown grace period.`);
  }

  // QNBS-v3: accepts either "died from the SIGTERM we sent" or "exited 0 on its own" as clean — anything else (e.g. SIGSEGV) is a real crash during shutdown, not evidence this proof should accept.
  const cleanShutdown = shutdownResult.signal === 'SIGTERM' || shutdownResult.code === 0;
  if (!cleanShutdown) {
    logStderr(index, stderr);
    throw new Error(
      `Cycle ${index + 1}: abnormal exit during shutdown (code=${shutdownResult.code}, signal=${shutdownResult.signal}).`,
    );
  }

  if (processTreeAlive()) {
    logStderr(index, stderr);
    throw new Error(`Cycle ${index + 1}: orphaned worldscript_host process(es) still running.`);
  }

  // QNBS-v3: required per cycle, not aggregated across the whole run — Qodo review finding on PR #388 ("FFI proof is not repeated"); one cycle's success must never mask another cycle's failure.
  if (!stdout.includes(FFI_PROOF_LINE)) {
    logStderr(index, stderr);
    throw new Error(`Cycle ${index + 1}: no FFI boundary proof ("${FFI_PROOF_LINE}") observed.`);
  }
  if (!stdout.includes(EXPECTED_TITLE_LINE)) {
    logStderr(index, stderr);
    throw new Error(
      `Cycle ${index + 1}: expected "${EXPECTED_TITLE_LINE}" not observed — the production bundle may not have rendered (a CEF error page would not produce this specific title).`,
    );
  }

  console.log(
    `[launch-cycle-proof] Cycle ${index + 1}/${cycles}: clean exit (signal=${shutdownResult.signal}), FFI + rendering proofs both present.`,
  );
}

async function main() {
  for (let i = 0; i < cycles; i++) {
    await runCycle(i);
  }

  console.log(
    `[launch-cycle-proof] OK — ${cycles}/${cycles} repeated start/close cycles clean, FFI boundary and real rendering both proven in every cycle.`,
  );
}

main().catch((err) => {
  console.error(`[launch-cycle-proof] FAIL — ${err.message}`);
  process.exit(1);
});
