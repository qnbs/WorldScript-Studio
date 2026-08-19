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
 * Each cycle must independently show three proofs, not just "at least one cycle across
 * the whole run" (a real review finding — masking a later cycle's failure behind an
 * earlier success would make the proof meaningless):
 *   - FFI boundary: apps/desktop-cef/src/worldscript_handler.cpp's OnAfterCreated
 *     calls into rust-core deterministically, regardless of page content.
 *   - Real rendering: the page's title must be exactly "WorldScript Studio" — a CEF
 *     error page (bad bundle, load failure) would not produce that specific title,
 *     so this catches "CEF started but the app didn't actually render" failures the
 *     FFI proof alone cannot.
 *   - Accessibility state requested: SetAccessibilityState(STATE_ENABLED) is called on
 *     every cycle (see the Early Accessibility Gate note below).
 *
 * Early Accessibility Gate (roadmap §3142): apps/desktop-cef's OnAfterCreated calls
 * browser->GetHost()->SetAccessibilityState(STATE_ENABLED) on every cycle — the real,
 * windowed-mode-appropriate API (CefClient has no GetAccessibilityHandler(); that method
 * is on CefRenderHandler, which is OSR-only and doesn't apply to this Views-based host —
 * see docs/cef/knowledge/cef-architecture-primer.md). This proves accessibility state can
 * be enabled intentionally (roadmap §23.1's first bullet); it does not yet prove the
 * platform accessibility tree is actually observable — that needs OS-level AT-SPI
 * introspection, not a CEF callback, and is separate follow-up work.
 *
 * After the repeated cycles, one additional crash-reporting proof runs
 * (runCrashReportingProofCycle): launches with chrome://crash to deliberately crash
 * the renderer subprocess, verifies CefCrashReportingEnabled() was true, verifies the
 * browser process survived (CefRequestHandler::OnRenderProcessTerminated fired instead
 * of the whole process dying), and verifies a real dump file was written to a
 * BREAKPAD_DUMP_LOCATION-overridden directory. Full symbolization (dump_syms /
 * minidump_stackwalk) needs a complete Chromium source checkout and is genuinely out of
 * reach of this project's minimal-CEF-SDK-only CI setup — see the primer doc.
 *
 * Run: node scripts/cef/run-launch-cycle-proof.mjs <binary-path> <url> [--cycles N]
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [binaryPath, url] = process.argv.slice(2);

const cyclesArgIdx = process.argv.indexOf('--cycles');
// QNBS-v3: distinguishes "flag absent" (default 3) from "flag present but no value" (e.g. trailing --cycles) — a naive undefined-check would silently default the latter too, same footgun class as fetch-cef-sdk.mjs's --cache-dir.
const cyclesArg = cyclesArgIdx !== -1 ? process.argv[cyclesArgIdx + 1] : undefined;
const cycles = cyclesArgIdx === -1 ? 3 : Number(cyclesArg);

// QNBS-v3: raised from 4000ms after two consecutive CI runs on identical code (byte-for-byte matching main, which had passed reliably before) showed the browser process alive but never reaching OnAfterCreated within the old window — runner-speed variance, not a code regression.
const STARTUP_GRACE_MS = 10000;
const SHUTDOWN_GRACE_MS = 6000;
// QNBS-v3: extra buffer after the main process exits — a renderer/GPU subprocess can take a moment longer to actually be reaped than its parent (docs/cef/knowledge/subprocess-and-shutdown.md's own "not instantaneous" finding applies to the whole tree, not just the browser process).
const ORPHAN_CHECK_GRACE_MS = 3000;
const FFI_PROOF_LINE = 'rust_core ping = 424242';
const EXPECTED_TITLE_LINE = 'title = WorldScript Studio';
// QNBS-v3: proves SetAccessibilityState(STATE_ENABLED) is requested on every cycle, not just once — same "no cycle can mask another" discipline as the FFI/title proofs above.
const ACCESSIBILITY_STATE_PROOF_LINE = 'accessibility_state_requested = true';

// QNBS-v3: crash-reporting/symbolization competency-gate proof (CEF-RUST-COMPETENCY-MATRIX.md) — mechanism verified against real CEF 151 source (libcef/common/crash_reporting.cc, crash_reporter_client.cc), not assumed; see docs/cef/knowledge/cef-architecture-primer.md.
const CRASH_REPORTING_ENABLED_LINE = 'crash_reporting_enabled = true';
// QNBS-v3: requires the specific TS_PROCESS_CRASHED value, not a bare "status=" prefix — CodeAnt review finding on PR #392 (TS_LAUNCH_FAILED/TS_PROCESS_WAS_KILLED/TS_ABNORMAL_TERMINATION would otherwise also satisfy the proof).
const RENDERER_CRASHED_PROOF_LINE = 'renderer_terminated status=TS_PROCESS_CRASHED';
const CRASH_URL = 'chrome://crash';
// QNBS-v3: Crashpad's dump finalization is asynchronous relative to OnRenderProcessTerminated — CodeAnt review finding on PR #392; this is how long the harness waits for a real .dmp file before giving up, separate from SHUTDOWN_GRACE_MS's own meaning. Set generously (not the original 5000ms) per the same CI-runner-speed-variance lesson that forced STARTUP_GRACE_MS up from 4000ms to 10000ms in this same file — proactive, not waiting for a flaky failure to prove it (second CodeAnt finding, same PR).
const DUMP_WRITE_GRACE_MS = 8000;

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

function listMatchingPids() {
  try {
    // QNBS-v3: anchored to the start of the command line — xvfb-run's own wrapper process also carries binaryPath as an argument it forwards, so an unanchored match false-flags it as a leaked worldscript_host.
    const out = execFileSync('pgrep', ['-f', `^${binaryPath}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((pid) => pid !== process.pid);
  } catch {
    return []; // pgrep exits 1 when nothing matches — that's the clean state.
  }
}

function processTreeAlive() {
  return listMatchingPids().length > 0;
}

// QNBS-v3: CEF re-execs the same binary for every subprocess role (renderer/GPU/crashpad-handler) — CodeAnt review finding on PR #392: SIGKILLing only the one tracked child PID can leave those descendants (including a Crashpad handler still writing to the dump directory) alive. This sweeps and kills everything matching the binary path, not just the direct child.
function killAllMatchingProcesses() {
  for (const pid of listMatchingPids()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone between the pgrep snapshot and this call — fine.
    }
  }
}

function logStderr(label, stderr) {
  if (stderr) console.error(`[launch-cycle-proof] ${label} stderr:\n${stderr}`);
}

// QNBS-v3: recursive, not a flat readdir — Crashpad's on-disk database nests reports under subdirectories (e.g. pending/, completed/, attachments/) whose exact layout isn't asserted on here; callers filter the result to *.dmp specifically (settings.dat/lock/.meta files are written during normal init and are not evidence of a dump).
function findFilesRecursive(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? findFilesRecursive(full) : [full];
  });
}

async function runCycle(index) {
  console.log(`[launch-cycle-proof] Cycle ${index + 1}/${cycles}: launching…`);
  // QNBS-v3: cwd set to the binary's own directory — Chromium resolves several resource paths (icudtl.dat et al.) relative to cwd, not the executable's location; without this, "Invalid file descriptor to ICU data received" crashes it on startup even though every file is correctly present.
  // QNBS-v3: verbose CEF/Chromium logging to stderr — an early crash otherwise produces zero diagnostic output, making root-causing it impossible from this harness's own log.
  const child = spawn(binaryPath, [`--url=${url}`, '--enable-logging=stderr', '--v=1'], {
    cwd: path.dirname(binaryPath),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(
      `Cycle ${index + 1}: exited during startup (code=${earlyExit.code}, signal=${earlyExit.signal}) instead of staying up — likely a crash, not a deliberate shutdown.`,
    );
  }

  child.kill('SIGTERM');
  const shutdownResult = await Promise.race([exited, sleep(SHUTDOWN_GRACE_MS).then(() => null)]);
  if (!shutdownResult) {
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(`Cycle ${index + 1}: process did not exit within the shutdown grace period.`);
  }

  // QNBS-v3: accepts either "died from the SIGTERM we sent" or "exited 0 on its own" as clean — anything else (e.g. SIGSEGV) is a real crash during shutdown, not evidence this proof should accept.
  const cleanShutdown = shutdownResult.signal === 'SIGTERM' || shutdownResult.code === 0;
  if (!cleanShutdown) {
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(
      `Cycle ${index + 1}: abnormal exit during shutdown (code=${shutdownResult.code}, signal=${shutdownResult.signal}).`,
    );
  }

  await sleep(ORPHAN_CHECK_GRACE_MS);
  if (processTreeAlive()) {
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(`Cycle ${index + 1}: orphaned worldscript_host process(es) still running.`);
  }

  // QNBS-v3: required per cycle, not aggregated across the whole run — Qodo review finding on PR #388 ("FFI proof is not repeated"); one cycle's success must never mask another cycle's failure.
  if (!stdout.includes(FFI_PROOF_LINE)) {
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(`Cycle ${index + 1}: no FFI boundary proof ("${FFI_PROOF_LINE}") observed.`);
  }
  if (!stdout.includes(EXPECTED_TITLE_LINE)) {
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(
      `Cycle ${index + 1}: expected "${EXPECTED_TITLE_LINE}" not observed — the production bundle may not have rendered (a CEF error page would not produce this specific title).`,
    );
  }
  if (!stdout.includes(ACCESSIBILITY_STATE_PROOF_LINE)) {
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(
      `Cycle ${index + 1}: expected "${ACCESSIBILITY_STATE_PROOF_LINE}" not observed — SetAccessibilityState(STATE_ENABLED) was not requested.`,
    );
  }
  console.log(
    `[launch-cycle-proof] Cycle ${index + 1}/${cycles}: clean exit (signal=${shutdownResult.signal}), FFI + rendering + accessibility-state proofs all present.`,
  );
}

// QNBS-v3: separate function, not a mode flag on runCycle — keeps the already-proven repeated-cycle proof completely untouched (the accessibility-attempt regression on PR #391 was caused by exactly this kind of shared-code coupling).
async function runCrashReportingProofCycle() {
  console.log(
    `[launch-cycle-proof] Crash-reporting proof: launching with ${CRASH_URL} to deliberately crash the renderer…`,
  );
  // QNBS-v3: fresh, empty-at-start temp dir — BREAKPAD_DUMP_LOCATION (verified in libcef/common/crash_reporter_client.cc) overrides where CEF/Crashpad writes dumps on Linux/POSIX, so a *.dmp file appearing here is unambiguous evidence, no need to guess CEF's default directory layout.
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldscript-crash-dumps-'));

  const child = spawn(binaryPath, [`--url=${CRASH_URL}`, '--enable-logging=stderr', '--v=1'], {
    cwd: path.dirname(binaryPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BREAKPAD_DUMP_LOCATION: dumpDir },
  });

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

  // QNBS-v3: every throw below is caught here so the child is always reaped, even on a failed proof — CodeAnt/Qodo review finding on PR #392 (a thrown assertion left the browser and its subprocesses orphaned).
  try {
    // QNBS-v3: `stopPolling` lets each while-loop below notice its own Promise.race already settled — CodeRabbit review finding on PR #392 (an abandoned loop kept scheduling sleep(200) forever after the race resolved via the other arm, keeping the Node process alive indefinitely on a failed/timed-out proof).
    let stopPolling = false;

    // QNBS-v3: requires the specific TS_PROCESS_CRASHED value, not just any termination status — CodeAnt review finding on PR #392 (TS_LAUNCH_FAILED/TS_PROCESS_WAS_KILLED/TS_ABNORMAL_TERMINATION would otherwise also satisfy a bare prefix match). chrome://crash triggers a real SIGSEGV in the renderer, confirmed against CEF's own cefclient reference usage of this exact URL.
    const rendererCrashed = await Promise.race([
      (async () => {
        while (!stopPolling && !stdout.includes(RENDERER_CRASHED_PROOF_LINE)) {
          await sleep(200);
        }
        return stdout.includes(RENDERER_CRASHED_PROOF_LINE);
      })(),
      exited.then(() => false),
      sleep(STARTUP_GRACE_MS).then(() => false),
    ]);
    stopPolling = true;

    if (!rendererCrashed) {
      throw new Error(
        `"${RENDERER_CRASHED_PROOF_LINE}" not observed within ${STARTUP_GRACE_MS}ms (or the process exited early) — stdout so far:\n${stdout}`,
      );
    }
    // QNBS-v3: echoed on the success path too, not just via logStderr on failure — the raw child stdout is otherwise invisible in the CI log (Qodo/CodeAnt review context on PR #392: nothing here previously proved which status value was actually observed).
    console.log(
      `[launch-cycle-proof] Crash-reporting proof: observed "${RENDERER_CRASHED_PROOF_LINE}".`,
    );

    // QNBS-v3: the actual "renderer termination observed and handled" evidence (CEF-RUST-COMPETENCY-MATRIX.md) — only the renderer subprocess should have died; the browser process and its message loop must still be running.
    if (!processTreeAlive()) {
      throw new Error(
        'browser process is not alive after the renderer crash — process isolation did not hold.',
      );
    }

    if (!stdout.includes(CRASH_REPORTING_ENABLED_LINE)) {
      throw new Error(
        `"${CRASH_REPORTING_ENABLED_LINE}" not observed — crash_reporter.cfg (apps/desktop-cef/resources/crash_reporter.cfg) was not found/parsed next to the binary.`,
      );
    }

    // QNBS-v3: Crashpad's dump finalization is asynchronous relative to OnRenderProcessTerminated — CodeAnt review finding on PR #392 (shutting down the browser immediately raced the dump actually being written). Wait for a real *.dmp file, bounded, before sending SIGTERM.
    stopPolling = false;
    const dumpAppeared = await Promise.race([
      (async () => {
        while (
          !stopPolling &&
          findFilesRecursive(dumpDir).filter((f) => f.endsWith('.dmp')).length === 0
        ) {
          await sleep(200);
        }
        return findFilesRecursive(dumpDir).some((f) => f.endsWith('.dmp'));
      })(),
      sleep(DUMP_WRITE_GRACE_MS).then(() => false),
    ]);
    stopPolling = true;
    // QNBS-v3: filtered to .dmp specifically — CodeAnt/Qodo review finding on PR #392 (Crashpad's settings.dat/lock/.meta files are written during normal init and would otherwise falsely count as "a dump produced").
    const dumpFiles = findFilesRecursive(dumpDir).filter((f) => f.endsWith('.dmp'));
    if (!dumpAppeared || dumpFiles.length === 0) {
      throw new Error(
        `no .dmp file appeared under BREAKPAD_DUMP_LOCATION (${dumpDir}) within ${DUMP_WRITE_GRACE_MS}ms despite crash_reporting_enabled=true and an observed renderer crash.`,
      );
    }
    console.log(
      `[launch-cycle-proof] Crash-reporting proof: dump file(s) confirmed before shutdown: ${dumpFiles.join(', ')}`,
    );

    child.kill('SIGTERM');
    const shutdownResult = await Promise.race([exited, sleep(SHUTDOWN_GRACE_MS).then(() => null)]);
    if (!shutdownResult) {
      throw new Error(
        'process did not exit within the shutdown grace period after the renderer crash.',
      );
    }
    // QNBS-v3: same clean-shutdown check as runCycle — Qodo review finding on PR #392 (the crash cycle accepted any exit, including an abnormal one, as a successful isolation proof).
    const cleanShutdown = shutdownResult.signal === 'SIGTERM' || shutdownResult.code === 0;
    if (!cleanShutdown) {
      throw new Error(
        `abnormal exit during shutdown (code=${shutdownResult.code}, signal=${shutdownResult.signal}).`,
      );
    }

    await sleep(ORPHAN_CHECK_GRACE_MS);
    if (processTreeAlive()) {
      throw new Error('orphaned worldscript_host process(es) still running after shutdown.');
    }

    console.log(
      '[launch-cycle-proof] Crash-reporting proof: OK — crash reporting enabled, renderer crash observed and handled (browser process survived), ' +
        `${dumpFiles.length} dump file(s) written to the crash dump location. Full symbolization (dump_syms/minidump_stackwalk) requires a complete Chromium source checkout and is out of scope — see docs/cef/knowledge/cef-architecture-primer.md.`,
    );
  } catch (err) {
    logStderr('Crash-reporting proof', stderr);
    // QNBS-v3: unconditional, not `if (!child.killed)` — .killed only reflects whether kill() was ever called, not whether the process actually died (e.g. SIGTERM already sent but the shutdown-grace-period/orphan checks below still failed); kill() on an already-exited process is a harmless no-op.
    child.kill('SIGKILL');
    // QNBS-v3: await + verify, not fire-and-forget — CodeAnt review finding on PR #392 (the normal shutdown path waits and checks for orphans; the failure path didn't, so a failed proof could leave CEF subprocesses running after the harness exits).
    await Promise.race([exited, sleep(SHUTDOWN_GRACE_MS)]);
    // QNBS-v3: sweeps every process matching the binary path, not just the tracked child — CodeAnt review finding on PR #392 (a surviving renderer/GPU/crashpad-handler descendant could still be using dumpDir when the finally block below removes it). Runs before that removal, not after.
    if (processTreeAlive()) {
      killAllMatchingProcesses();
      await sleep(ORPHAN_CHECK_GRACE_MS);
      if (processTreeAlive()) {
        console.error(
          '[launch-cycle-proof] Crash-reporting proof: WARNING — worldscript_host process(es) still running after failure cleanup.',
        );
      }
    }
    throw new Error(`Crash-reporting proof: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // QNBS-v3: CodeRabbit review finding on PR #392 — the dump directory (which can contain real browser memory) was never removed on success or failure. Runs after the process-tree sweep above, not before, so it never races a still-running Crashpad handler.
    fs.rmSync(dumpDir, { recursive: true, force: true });
  }
}

async function main() {
  for (let i = 0; i < cycles; i++) {
    await runCycle(i);
  }

  console.log(
    `[launch-cycle-proof] OK — ${cycles}/${cycles} repeated start/close cycles clean, FFI boundary, real rendering, and accessibility-state request all proven in every cycle.`,
  );

  await runCrashReportingProofCycle();
}

main().catch((err) => {
  console.error(`[launch-cycle-proof] FAIL — ${err.message}`);
  process.exit(1);
});
