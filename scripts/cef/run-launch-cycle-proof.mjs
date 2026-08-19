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
// QNBS-v3: PR #404 finding — under the real Linux sandbox, Crashpad's ptrace-based renderer-crash-dump path is a separately-tracked, currently-open regression (prctl(PR_SET_PTRACER) EINVAL, likely a PID-namespace-relative mismatch) unrelated to the 3-cycle lifecycle proof's own health. These flags let CI run the two as independent steps with independent pass/fail status instead of one proof's failure hiding the other's real result — default (neither flag) keeps prior behavior unchanged.
const skipCrashReporting = process.argv.includes('--skip-crash-reporting');
const onlyCrashReporting = process.argv.includes('--only-crash-reporting');
// QNBS-v3: real false-green risk flagged in review — both flags together would skip the lifecycle loop (onlyCrashReporting) AND the crash-reporting cycle (skipCrashReporting), so main() would do nothing at all and exit 0 having tested nothing.
if (skipCrashReporting && onlyCrashReporting) {
  console.error(
    '[launch-cycle-proof] --skip-crash-reporting and --only-crash-reporting are mutually exclusive — together they would run neither proof and exit 0.',
  );
  process.exit(1);
}

// QNBS-v3: raised from 4000ms after two consecutive CI runs on identical code (byte-for-byte matching main, which had passed reliably before) showed the browser process alive but never reaching OnAfterCreated within the old window — runner-speed variance, not a code regression.
// QNBS-v3: raised again from 10000ms after the same "Cycle 1: no FFI boundary proof" symptom
// recurred on a main push right after PR #400 added -g to worldscript_host — real, measured
// evidence: the binary grew from 1.34MB to 6.33MB (target_compile_options in
// apps/desktop-cef/CMakeLists.txt), a plausible contributor to slower first-launch I/O on a
// loaded runner. Cycles 2/3 in runCycle always passed at the old window — the actual observed
// failure only ever hit the cold first launch there. This constant is also read by
// runCrashReportingProofCycle's own renderer-crash-detection timeout below (line ~278) — a
// shared constant, not a runCycle-only one; that consumer's failure-detection window widens by
// the same 5s as a side effect, which is fine (strictly more lenient, same CI-runner-speed
// rationale applies), not a dedicated timeout since there's no evidence the two need to differ.
const STARTUP_GRACE_MS = 15000;
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

// QNBS-v3: pgrep -f treats its argument as an extended regex — CodeRabbit finding on PR #400 (run-symbolization-proof.mjs), applied here too since this older file predates that fix and shares the exact same footgun.
const binaryPathPattern = binaryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function listMatchingPids() {
  try {
    // QNBS-v3: anchored to the start of the command line — xvfb-run's own wrapper process also carries binaryPath as an argument it forwards, so an unanchored match false-flags it as a leaked worldscript_host.
    const out = execFileSync('pgrep', ['-f', `^${binaryPathPattern}`], {
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

// QNBS-v3: PR #404's real per-process diagnostic evidence (Seccomp/NoNewPrivs/CapEff/user-ns) for the crash-reporting-under-sandbox investigation — logged, never asserted on here (that assertion belongs to run-sandbox-status-proof.mjs), purely so a failed dump-write attempt leaves behind the exact process topology needed to diagnose it instead of just a bare timeout message.
// QNBS-v3: real bug caught by reading this PR's own captured evidence — Chromium's zygote-forked children (renderer/gpu-process/utility) rewrite their own argv memory for `ps`-friendly display (a common multi-process-app trick), which collapses the normally NUL-separated /proc/<pid>/cmdline into a single space-joined string with no NUL separators at all. A bare split('\0') then returns a one-element array whose lone entry never startsWith('--type='), silently defaulting classifyRole to 'browser' for every zygote-forked process — real renderer/gpu-process/utility entries were mislabeled 'browser' in this file's earlier runs. Falls back to a whitespace split specifically for that single-element shape.
function readCmdline(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const nulSplit = raw.split('\0').filter(Boolean);
    if (nulSplit.length === 1 && nulSplit[0].includes(' ')) {
      return nulSplit[0].split(' ').filter(Boolean);
    }
    return nulSplit;
  } catch {
    return null;
  }
}

function readProcStatusField(pid, fieldName) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const line = status.split('\n').find((l) => l.startsWith(`${fieldName}:`));
    return line ? (line.split(':')[1] ?? '').trim() : null;
  } catch {
    return null;
  }
}

function readUserNsId(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/ns/user`);
  } catch {
    return null;
  }
}

// QNBS-v3: real review refinement — NSpid's vector *length* only proves nesting depth, not namespace *identity*; two processes can sit at equal depth in different sibling PID namespaces. The PID-namespace inode (readlink /proc/<pid>/ns/pid) is the actual identity comparison the PID-namespace-mismatch hypothesis needs — a separate namespace type from ns/user, not a substitute for it.
function readPidNsId(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/ns/pid`);
  } catch {
    return null;
  }
}

// QNBS-v3: ns/pid (this process's OWN membership) vs. ns/pid_for_children (the namespace any NEW child it forks would join) can legitimately differ — that's exactly the zygote/sandbox-setup shape (a still-ambient-namespace parent about to fork a child into a freshly-created one), real topology evidence distinct from ns/pid alone.
function readPidNsForChildrenId(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/ns/pid_for_children`);
  } catch {
    return null;
  }
}

// QNBS-v3: real bug caught in review (second pass) — Chromium propagates --crashpad-handler-pid=<pid> to CLIENT processes (renderer/GPU/utility) too, so they can declare the handler via PR_SET_PTRACER; a broad "does cmdline contain crashpad anywhere" match (the original isCrashpadCandidate design) would misclassify the actual renderer as the handler, corrupting exactly the renderer-vs-handler comparison this file exists to make. --type= is Chromium's own authoritative subprocess-type declaration and always takes precedence when present (covers the handler too, if this CEF/Crashpad build gives it --type=crashpad-handler). Only when --type= is ABSENT does this fall back to handler-SPECIFIC flags — --initial-client-fd / --shared-client-connection are received only by the handler at its own spawn time, never by its clients (which only ever receive the client-side --crashpad-handler-pid=<pid>).
function classifyRole(pid) {
  const cmdline = readCmdline(pid);
  if (!cmdline) return null;
  const typeArg = cmdline.find((a) => a.startsWith('--type='));
  if (typeArg) return typeArg.slice('--type='.length);
  const looksLikeHandler = cmdline.some(
    (a) => a.startsWith('--initial-client-fd') || a.startsWith('--shared-client-connection'),
  );
  return looksLikeHandler ? 'crashpad-handler' : 'browser';
}

// QNBS-v3: readlink of the resolved binary, distinct from (and more trustworthy than) the cmdline-based guess above — real, auditable proof of which executable a PID actually is, requested in review alongside cmdline for identity verification.
function readExePath(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
}

// QNBS-v3: corroborating/informational only, deliberately NOT used to drive classifyRole's own judgment (see that function's comment for why a broad substring match is unsafe here) — kept only to widen the pgrep-based process enumeration in case the handler doesn't match binaryPathPattern at all (a distinct re-exec path, not necessarily worldscript_host itself).
function listCrashpadCmdlineMatchPids() {
  try {
    const out = execFileSync('pgrep', ['-if', 'crashpad'], {
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

function logProcessTreeDiagnostic(label) {
  const ownUserNs = readUserNsId(process.pid);
  const ownPidNs = readPidNsId(process.pid);
  const matchedPids = listMatchingPids();
  const crashpadCmdlinePids = listCrashpadCmdlineMatchPids();
  // QNBS-v3: real evidence request from PR #404's review — NSpid (nesting depth) and ns/pid (actual namespace identity/inode) are both captured from THIS (ambient) namespace, which can see the full nesting chain even without joining any child namespace. Equal NSpid vector *length* does not prove two processes share a namespace — only a matching ns/pid identity does; that's the real test the PID-namespace-mismatch hypothesis needs, not an inference from Seccomp/user-ns alone.
  const allPids = [...new Set([...matchedPids, ...crashpadCmdlinePids])];
  console.log(
    `[launch-cycle-proof] ${label}: ${matchedPids.length} worldscript_host-matching process(es), ${crashpadCmdlinePids.length} crashpad-cmdline-matching process(es) (informational only — role classification below never uses this list, see classifyRole's own comment).`,
  );
  const seen = [];
  for (const pid of allPids) {
    const role = classifyRole(pid) ?? '(unreadable)';
    const ppid = readProcStatusField(pid, 'PPid');
    const seccomp = readProcStatusField(pid, 'Seccomp');
    const noNewPrivs = readProcStatusField(pid, 'NoNewPrivs');
    const capEff = readProcStatusField(pid, 'CapEff');
    const nsPid = readProcStatusField(pid, 'NSpid');
    const userNs = readUserNsId(pid);
    const pidNs = readPidNsId(pid);
    const pidNsForChildren = readPidNsForChildrenId(pid);
    const exePath = readExePath(pid);
    const cmdline = readCmdline(pid);
    console.log(
      `  pid=${pid} ppid=${ppid ?? '(unreadable)'} role=${role} exe=${exePath ?? '(unreadable)'} cmdline=${cmdline ? JSON.stringify(cmdline) : '(unreadable)'} ` +
        `NSpid=${nsPid ?? '(unreadable)'} pid-ns=${pidNs ?? '(unreadable)'} pid-ns-for-children=${pidNsForChildren ?? '(unreadable)'} ` +
        `Seccomp=${seccomp ?? '(unreadable)'} NoNewPrivs=${noNewPrivs ?? '(unreadable)'} CapEff=${capEff ?? '(unreadable)'} user-ns=${userNs ?? '(unreadable)'} ` +
        `distinct-pid-ns-from-harness=${pidNs !== null && pidNs !== ownPidNs} distinct-user-ns-from-harness=${userNs !== null && userNs !== ownUserNs}`,
    );
    // QNBS-v3: CodeRabbit finding, PR #404 — listCrashpadCmdlineMatchPids' unanchored pgrep -if crashpad can return unrelated runner processes; without this flag, a foreign process with no --type= and no handler-specific flag would fall through to role='browser' and enter the comparison below, producing a misleading namespace-mismatch line against a process that was never part of this host's own tree.
    seen.push({ pid, role, pidNs, hostMatched: matchedPids.includes(pid) });
  }
  // QNBS-v3: the decisive comparisons per PR #404's review — actual pid-ns *identity*, not just distance-from-harness. renderer-vs-handler tests the core mismatch hypothesis directly; browser-vs-handler is the strongest corroborating signal (if they match while renderer differs, that elegantly explains why only the sandboxed renderer's PR_SET_PTRACER call ever sees EINVAL). Neither comparison alone proves the *exact* numeric handler_pid value is unresolvable inside the renderer's namespace (that would need a live syscall trace, deliberately not attempted — see the "no strace" note on this function's own commit) — this is strong, non-invasive supporting or refuting evidence for the hypothesis, stated as such, not a definitive syscall-level proof.
  const browsers = seen.filter((p) => p.role === 'browser' && p.pidNs !== null && p.hostMatched);
  const renderers = seen.filter((p) => p.role === 'renderer' && p.pidNs !== null);
  const handlers = seen.filter((p) => p.role === 'crashpad-handler' && p.pidNs !== null);
  for (const h of handlers) {
    for (const r of renderers) {
      console.log(
        `  [pid-ns identity check] renderer pid=${r.pid} pid-ns=${r.pidNs} vs. handler(?) pid=${h.pid} pid-ns=${h.pidNs}: ${r.pidNs === h.pidNs ? 'SAME namespace (rejects the mismatch hypothesis for this pair)' : 'DIFFERENT namespaces (supports the mismatch hypothesis for this pair)'}`,
      );
    }
    for (const b of browsers) {
      console.log(
        `  [pid-ns identity check] browser pid=${b.pid} pid-ns=${b.pidNs} vs. handler(?) pid=${h.pid} pid-ns=${h.pidNs}: ${b.pidNs === h.pidNs ? 'SAME namespace' : 'DIFFERENT namespaces'} (browser sharing the handler's namespace while the renderer above does not would explain why only the sandboxed renderer's PR_SET_PTRACER ever sees EINVAL)`,
      );
    }
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
  // QNBS-v3: 'exit' fires as soon as the process terminates but its stdio streams can still be open (buffered output not yet fully delivered); 'close' is the guarantee all of it has arrived — CodeRabbit review finding on PR #397, backed by real Node.js child_process docs and a reproduction. Only gates the stdout marker checks below, not the exit/signal checks above, which are legitimately about process termination itself.
  const closed = new Promise((resolve) => child.once('close', () => resolve()));

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

  // QNBS-v3: waits for 'close' (all stdio fully drained), not just 'exit' — see the QNBS-v3 comment where `closed` is declared above. Bounded rather than awaited outright, matching this file's established defensive-timeout convention even though close should already have fired well within ORPHAN_CHECK_GRACE_MS in practice.
  const streamsClosed = await Promise.race([
    closed.then(() => true),
    sleep(2000).then(() => false),
  ]);
  if (!streamsClosed) {
    logStderr(`Cycle ${index + 1}`, stderr);
    throw new Error(
      `Cycle ${index + 1}: stdio streams did not close within 2000ms after process exit.`,
    );
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

  // QNBS-v3: --v=2 (not runCycle's --v=1) specifically for this cycle — PR #404's investigation needs any VLOG(2)-level Crashpad-internal logging (PR_SET_PTRACER/broker decisions) that --v=1 doesn't surface; scoped to this cycle only so the already-proven lifecycle proof's log volume/behavior stays untouched.
  const child = spawn(binaryPath, [`--url=${CRASH_URL}`, '--enable-logging=stderr', '--v=2'], {
    cwd: path.dirname(binaryPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BREAKPAD_DUMP_LOCATION: dumpDir },
  });

  let stdout = '';
  let stderr = '';
  // QNBS-v3: PR #404's own captured log shows the crash → prctl(PR_SET_PTRACER) EINVAL → ptrace EPERM sequence completes in well under 200ms — the stdout-polling snapshot below (200ms cadence) risks firing after the Crashpad handler process has already exited on failure. This stderr-event-driven snapshot fires the instant the relevant log line is flushed, maximizing the chance of catching it still alive. Fires at most once (ptraceDiagnosticLogged guard) even though multiple matching lines can appear across renderer respawns.
  // QNBS-v3: real regex miss caught in review — the actual EARLIEST failure line in this PR's own captured log ("crashpad_client_linux.cc:376] prctl: Invalid argument (22)") contains neither "ptrace" nor "PR_SET_PTRACER" nor "scoped_ptrace_attach" as substrings (prctl is a distinct syscall name from the LATER ptrace() call), so the original regex only ever fired on the second, later failure line — missing the earliest, most diagnostically valuable moment entirely.
  let ptraceDiagnosticLogged = false;
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    if (
      !ptraceDiagnosticLogged &&
      /ptrace|PR_SET_PTRACER|scoped_ptrace_attach|crashpad_client_linux|prctl:/i.test(text)
    ) {
      ptraceDiagnosticLogged = true;
      logProcessTreeDiagnostic(
        'Process tree at the instant a ptrace/prctl-related log line appeared',
      );
    }
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
    // QNBS-v3: captured immediately after the crash is detected, while the Crashpad handler should still be alive attempting the dump — this is the exact window PR #404's investigation needs real process-topology evidence for.
    logProcessTreeDiagnostic('Process tree immediately after renderer crash detected');

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
      // QNBS-v3: final-state snapshot, distinct from the immediately-post-crash one above — compares what survived the DUMP_WRITE_GRACE_MS wait against what existed right at crash time.
      logProcessTreeDiagnostic('Process tree at dump-write timeout (final state)');
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
  if (!onlyCrashReporting) {
    for (let i = 0; i < cycles; i++) {
      await runCycle(i);
    }

    console.log(
      `[launch-cycle-proof] OK — ${cycles}/${cycles} repeated start/close cycles clean, FFI boundary, real rendering, and accessibility-state request all proven in every cycle.`,
    );
  }

  if (!skipCrashReporting) {
    await runCrashReportingProofCycle();
  }
}

main().catch((err) => {
  console.error(`[launch-cycle-proof] FAIL — ${err.message}`);
  process.exit(1);
});
