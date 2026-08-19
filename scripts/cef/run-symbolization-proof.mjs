#!/usr/bin/env node
/**
 * Crash-symbolization proof for the Wave 2 CEF host (roadmap §3142 exit criterion
 * "initial crash-reporting/symbolization proof").
 *
 * The existing crash-reporting proof (run-launch-cycle-proof.mjs's runCrashReportingProofCycle)
 * deliberately crashes chrome://crash — a Chromium/CEF-internal renderer crash. That proves
 * *reporting* (a real Crashpad .dmp file is written), but its own comment is explicit that
 * *symbolizing* that specific dump is out of reach: the crash is entirely inside Chromium's own
 * stripped code, and CEF's official Spotify-hosted builds (verified against
 * https://cef-builds.spotifycdn.com/index.json for this project's pinned version) ship no
 * separate debug-symbols archive for any distribution type (standard/tools/minimal/client) — so
 * there is no way to symbolize Chromium-internal frames without building Chromium itself.
 *
 * This script proves the *other* half honestly instead: symbolizing a crash inside *our own*
 * code, which we compile ourselves and fully control the debug info for. It deliberately crashes
 * the browser process itself (not a renderer subprocess) via the --debug-crash-self CLI flag
 * (apps/desktop-cef/src/main.cpp), which calls a distinctively-named Rust function
 * (worldscript_rust_debug_crash_self_test, apps/desktop-cef/rust-core/src/lib.rs) that panics
 * under panic=abort — a real SIGABRT Crashpad catches the same way it caught the renderer crash.
 *
 * dump_syms (github.com/mozilla/dump_syms) and minidump-stackwalk (github.com/rust-minidump/
 * rust-minidump) are both standalone Rust projects with prebuilt Linux release binaries — neither
 * needs a Chromium checkout, confirmed by reading their own READMEs directly, not assumed. Their
 * combination is the same Breakpad-format toolchain Mozilla uses for real Firefox crash
 * symbolication, applied here to our own binary's DWARF debug info (RelWithDebInfo build +
 * rust-core's `debug = true` release-profile override — see cef-learning-harness.yml).
 *
 * Deliberately a separate script, not a mode flag on run-launch-cycle-proof.mjs's existing
 * crash-reporting proof — same "no shared-code coupling between proofs" discipline established
 * after the PR #391 accessibility-attempt regression.
 *
 * Run: node scripts/cef/run-symbolization-proof.mjs <binary-path> <dump-syms-path> <minidump-stackwalk-path>
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [binaryPath, dumpSymsPath, minidumpStackwalkPath] = process.argv.slice(2);

const STARTUP_GRACE_MS = 10000;
const SHUTDOWN_GRACE_MS = 6000;
const ORPHAN_CHECK_GRACE_MS = 3000;
const DUMP_WRITE_GRACE_MS = 8000;
const CRASH_TRIGGERED_LINE = 'debug_crash_self_test = triggering';
// QNBS-v3: the exact Rust function name — proves minidump-stackwalk actually resolved a symbol,
// not just that it ran without error (a tool that silently produced zero symbols would still
// exit 0 and emit valid-but-useless JSON).
const CRASH_FUNCTION_NAME = 'worldscript_rust_debug_crash_self_test';

if (!binaryPath || !dumpSymsPath || !minidumpStackwalkPath) {
  console.error(
    '[symbolization-proof] Usage: node scripts/cef/run-symbolization-proof.mjs <binary-path> <dump-syms-path> <minidump-stackwalk-path>',
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listMatchingPids() {
  try {
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
    return [];
  }
}

function processTreeAlive() {
  return listMatchingPids().length > 0;
}

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
  if (stderr) console.error(`[symbolization-proof] ${label} stderr:\n${stderr}`);
}

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

async function main() {
  console.log(
    '[symbolization-proof] Launching with --debug-crash-self to deliberately crash the browser process itself…',
  );
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldscript-symbolization-dumps-'));
  const symbolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldscript-symbolization-syms-'));

  const child = spawn(
    binaryPath,
    ['--url=about:blank', '--debug-crash-self', '--enable-logging=stderr', '--v=1'],
    {
      cwd: path.dirname(binaryPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BREAKPAD_DUMP_LOCATION: dumpDir },
    },
  );

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

  // QNBS-v3: every throw below is caught here so the child is always reaped — same discipline as
  // run-launch-cycle-proof.mjs's runCrashReportingProofCycle (PR #392 finding).
  try {
    let stopPolling = false;

    const crashTriggered = await Promise.race([
      (async () => {
        while (!stopPolling && !stdout.includes(CRASH_TRIGGERED_LINE)) {
          await sleep(200);
        }
        return stdout.includes(CRASH_TRIGGERED_LINE);
      })(),
      sleep(STARTUP_GRACE_MS).then(() => false),
    ]);
    stopPolling = true;
    if (!crashTriggered) {
      throw new Error(
        `"${CRASH_TRIGGERED_LINE}" not observed within ${STARTUP_GRACE_MS}ms — stdout so far:\n${stdout}`,
      );
    }

    const shutdownResult = await Promise.race([exited, sleep(SHUTDOWN_GRACE_MS).then(() => null)]);
    if (!shutdownResult) {
      throw new Error(
        'process did not exit within the shutdown grace period after the self-crash.',
      );
    }
    // QNBS-v3: panic=abort raises SIGABRT — anything else (a clean exit, SIGTERM) means the
    // crash trigger didn't actually crash the process, which would make the rest of this proof
    // meaningless (symbolizing a dump that was never really a crash).
    if (shutdownResult.signal !== 'SIGABRT') {
      throw new Error(
        `expected SIGABRT from the self-crash, got code=${shutdownResult.code} signal=${shutdownResult.signal}.`,
      );
    }
    console.log('[symbolization-proof] Browser process crashed via SIGABRT as expected.');

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
    const dumpFiles = findFilesRecursive(dumpDir).filter((f) => f.endsWith('.dmp'));
    if (!dumpAppeared || dumpFiles.length === 0) {
      throw new Error(
        `no .dmp file appeared under BREAKPAD_DUMP_LOCATION (${dumpDir}) within ${DUMP_WRITE_GRACE_MS}ms.`,
      );
    }
    console.log(`[symbolization-proof] Dump file confirmed: ${dumpFiles[0]}`);

    await sleep(ORPHAN_CHECK_GRACE_MS);
    if (processTreeAlive()) {
      throw new Error('orphaned worldscript_host process(es) still running after the self-crash.');
    }

    console.log('[symbolization-proof] Generating Breakpad symbols with dump_syms…');
    execFileSync(dumpSymsPath, ['-s', symbolsDir, binaryPath], { stdio: 'inherit' });
    const symFiles = findFilesRecursive(symbolsDir).filter((f) => f.endsWith('.sym'));
    if (symFiles.length === 0) {
      throw new Error(`dump_syms produced no .sym file under ${symbolsDir}.`);
    }
    console.log(`[symbolization-proof] Symbol file generated: ${symFiles[0]}`);

    console.log('[symbolization-proof] Running minidump-stackwalk…');
    const stackwalkOutput = execFileSync(
      minidumpStackwalkPath,
      ['--json', dumpFiles[0], symbolsDir],
      { encoding: 'utf8' },
    );
    if (!stackwalkOutput.includes(CRASH_FUNCTION_NAME)) {
      throw new Error(
        `minidump-stackwalk's output does not contain "${CRASH_FUNCTION_NAME}" — the crash frame was not symbolized. Output:\n${stackwalkOutput.slice(0, 4000)}`,
      );
    }

    console.log(
      `[symbolization-proof] OK — real Crashpad dump from a self-induced crash was symbolized end-to-end, resolving "${CRASH_FUNCTION_NAME}" via dump_syms + minidump-stackwalk. Chromium/CEF-internal frames remain unsymbolized (no debug-symbols archive is published for this distribution) — this proof is scoped to our own code, honestly, not the whole stack.`,
    );
  } catch (err) {
    logStderr('Symbolization proof', stderr);
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(SHUTDOWN_GRACE_MS)]);
    if (processTreeAlive()) {
      killAllMatchingProcesses();
      await sleep(ORPHAN_CHECK_GRACE_MS);
      if (processTreeAlive()) {
        console.error(
          '[symbolization-proof] WARNING — worldscript_host process(es) still running after failure cleanup.',
        );
      }
    }
    throw new Error(`Symbolization proof: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    fs.rmSync(dumpDir, { recursive: true, force: true });
    fs.rmSync(symbolsDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[symbolization-proof] FAIL — ${err.message}`);
  process.exit(1);
});
