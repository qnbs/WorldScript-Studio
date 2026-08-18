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
 * Also greps captured stdout for the Rust FFI boundary's proof line
 * (see apps/desktop-cef/src/worldscript_handler.cpp), so a single CI run proves both
 * "starts/stops cleanly" and "the FFI boundary works inside the real host" — not just
 * in the spike's decoupled isolation test.
 *
 * Run: node scripts/cef/run-launch-cycle-proof.mjs <binary-path> <url> [--cycles N]
 */
import { execFileSync, spawn } from 'node:child_process';

const [binaryPath, url] = process.argv.slice(2);
const cyclesArgIdx = process.argv.indexOf('--cycles');
const cycles = cyclesArgIdx !== -1 ? Number(process.argv[cyclesArgIdx + 1]) : 3;

const STARTUP_GRACE_MS = 4000;
const SHUTDOWN_GRACE_MS = 6000;

if (!binaryPath || !url) {
  console.error(
    '[launch-cycle-proof] Usage: node scripts/cef/run-launch-cycle-proof.mjs <binary-path> <url> [--cycles N]',
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processTreeAlive() {
  try {
    // QNBS-v3: excludes this Node process's own PID — it received binaryPath as a CLI arg, so a naive `pgrep -f` match on that string would always match itself.
    const out = execFileSync('pgrep', ['-f', binaryPath], { stdio: ['ignore', 'pipe', 'ignore'] })
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

async function runCycle(index) {
  console.log(`[launch-cycle-proof] Cycle ${index + 1}/${cycles}: launching…`);
  const child = spawn(binaryPath, [`--url=${url}`], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', () => {}); // GPU-fallback warnings etc. — not this proof's concern.

  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );

  await sleep(STARTUP_GRACE_MS);

  if (stdout.includes('rust_core ping = 424242')) {
    console.log("[launch-cycle-proof]   FFI boundary proof found in this cycle's output.");
  }

  child.kill('SIGTERM');
  await sleep(SHUTDOWN_GRACE_MS);

  const result = await Promise.race([exited, sleep(1000).then(() => null)]);
  if (!result) {
    throw new Error(`Cycle ${index + 1}: process did not exit within the shutdown grace period.`);
  }

  if (processTreeAlive()) {
    throw new Error(`Cycle ${index + 1}: orphaned worldscript_host process(es) still running.`);
  }

  console.log(
    `[launch-cycle-proof] Cycle ${index + 1}/${cycles}: clean exit (signal=${result.signal}).`,
  );
  return stdout;
}

async function main() {
  let sawFfiProof = false;
  for (let i = 0; i < cycles; i++) {
    const stdout = await runCycle(i);
    if (stdout.includes('rust_core ping = 424242')) sawFfiProof = true;
  }

  if (!sawFfiProof) {
    throw new Error(
      'No cycle produced the expected FFI boundary output ("rust_core ping = 424242") — the page may not have set a title, or the callback did not fire.',
    );
  }

  console.log(
    `[launch-cycle-proof] OK — ${cycles}/${cycles} repeated start/close cycles clean, FFI boundary proven inside the real host.`,
  );
}

main().catch((err) => {
  console.error(`[launch-cycle-proof] FAIL — ${err.message}`);
  process.exit(1);
});
