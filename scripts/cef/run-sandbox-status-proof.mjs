#!/usr/bin/env node
/**
 * Real Linux sandbox-status proof (Wave 2 exit criterion — the "real sandbox-enable attempt"
 * from docs/cef/knowledge/CEF-RUST-COMPETENCY-MATRIX.md's "Wave 2 remaining work" sequence).
 *
 * PR #402's diagnostic inventory (scripts/cef/check-linux-sandbox-inventory.mjs) only proved
 * unprivileged user-namespace creation is *functionally reachable* on this runner (a bare
 * `unshare` succeeded) — it never launched CEF with sandboxing enabled and changed nothing.
 * This script is the follow-up: apps/desktop-cef/src/main.cpp now sets
 * CefSettings.no_sandbox = false, and this harness reads REAL per-process evidence while the
 * host is actually running, rather than trusting "it launched without an error" as proof —
 * that alone would not distinguish a real sandbox from a silent fallback to an unsandboxed
 * launch, which is exactly the failure mode the primer doc's acceptance bar disallows.
 *
 * Per docs/cef/knowledge/cef-architecture-primer.md's "Acceptance bar for the follow-up enable
 * attempt": must show renderer/GPU/utility processes actually running under sandbox
 * restrictions, must distinguish namespace isolation (layer 1) from seccomp-BPF (layer 2)
 * since Chromium treats them independently, and must cause zero regression to the existing
 * lifecycle proof (FFI boundary, rendering).
 *
 * The browser process itself is intentionally NOT asserted on for sandbox evidence — Chromium's
 * own architecture never sandboxes the browser process; it is the trusted coordinator that sets
 * up sandboxing for its children. Its data is still logged, for transparency, alongside every
 * other observed process.
 *
 * Evidence collected per matching subprocess (via /proc/<pid>/status, /proc/<pid>/ns/user):
 *   - Seccomp: field (0=disabled, 1=strict, 2=filter) — layer-2 evidence.
 *   - NoNewPrivs: field (1 = execve cannot regain privileges) — a real, if partial, signal.
 *   - user-namespace identity (readlink /proc/<pid>/ns/user), compared against this harness's
 *     own namespace (which is the same ambient namespace the unsandboxed browser process itself
 *     runs in) — a distinct inode is real evidence a new user namespace was created for that
 *     child (layer-1 isolation). The two layers are reported separately, never collapsed into
 *     one pass/fail, since a process can show one without the other.
 *
 * This is CI-runner feasibility evidence, not a production-packaging sandbox proof — see the
 * primer doc's "two separate gates" note. A GitHub Actions runner proving our CEF configuration
 * is *capable* of sandboxed execution does not prove a future .deb/AppImage installer correctly
 * ships and permissions the sandbox helper on every target Linux distribution.
 *
 * Run: node scripts/cef/run-sandbox-status-proof.mjs <binary-path> <url>
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [binaryPath, url] = process.argv.slice(2);

// QNBS-v3: matches run-launch-cycle-proof.mjs's own tuned value — the same runner-speed-variance rationale applies to this harness's cold launch too.
const STARTUP_GRACE_MS = 15000;
const SHUTDOWN_GRACE_MS = 6000;
const ORPHAN_CHECK_GRACE_MS = 3000;
const FFI_PROOF_LINE = 'rust_core ping = 424242';
const EXPECTED_TITLE_LINE = 'title = WorldScript Studio';

if (!binaryPath || !url) {
  console.error(
    '[sandbox-status-proof] Usage: node scripts/cef/run-sandbox-status-proof.mjs <binary-path> <url>',
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// QNBS-v3: pgrep -f treats its argument as an extended regex — CodeRabbit finding on PR #400, same fix applied here.
const binaryPathPattern = binaryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function listMatchingPids() {
  try {
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
  if (stderr) console.error(`[sandbox-status-proof] ${label} stderr:\n${stderr}`);
}

// QNBS-v3: /proc/<pid>/cmdline is NUL-separated, not space-separated — splitting on spaces would break on any argument containing one (e.g. a --url value).
function readCmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  } catch {
    return null; // Process exited between the pgrep snapshot and this read — expected raciness, not an error.
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
    return null; // Permission denied or already exited — reported as "(unreadable)", not treated as distinct.
  }
}

function classifyRole(pid) {
  const cmdline = readCmdline(pid);
  if (!cmdline) return null;
  const typeArg = cmdline.find((a) => a.startsWith('--type='));
  return typeArg ? typeArg.slice('--type='.length) : 'browser';
}

// QNBS-v3: the acceptance bar in cef-architecture-primer.md explicitly disallows trading no_sandbox=true for a narrower blanket disable (e.g. --disable-setuid-sandbox) while still claiming this row proven — this makes that prose rule a real, automated check against every observed process's actual command line, not just a promise nothing in main.cpp passes these.
const FORBIDDEN_SANDBOX_WEAKENING_FLAGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-seccomp-filter-sandbox',
  '--disable-namespace-sandbox',
  '--disable-gpu-sandbox',
];

function findForbiddenFlags(pid) {
  const cmdline = readCmdline(pid);
  if (!cmdline) return [];
  return cmdline.filter((arg) => FORBIDDEN_SANDBOX_WEAKENING_FLAGS.includes(arg));
}

async function main() {
  console.log(
    '[sandbox-status-proof] Launching worldscript_host with sandboxing enabled (no_sandbox=false)…',
  );
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

  // QNBS-v3: every throw below is caught by this try and swept up in the finally block — CodeRabbit-class finding raised on this PR (missing guaranteed cleanup), mirroring run-launch-cycle-proof.mjs's runCrashReportingProofCycle try/finally pattern. Without this, an assertion failure could leave a sandboxed CEF process tree running past this step, contaminating the Wayland smoke proof that runs after it (this step is continue-on-error).
  try {
    const earlyExit = await Promise.race([exited, sleep(STARTUP_GRACE_MS).then(() => null)]);
    if (earlyExit) {
      logStderr('startup', stderr);
      throw new Error(
        `exited during startup (code=${earlyExit.code}, signal=${earlyExit.signal}) instead of staying up — a sandbox-init failure is a real, plausible cause here, not assumed unrelated.`,
      );
    }

    if (!stdout.includes(FFI_PROOF_LINE) || !stdout.includes(EXPECTED_TITLE_LINE)) {
      logStderr('startup', stderr);
      throw new Error(
        `sandboxed launch did not reach the same FFI/rendering proofs the unsandboxed lifecycle harness relies on — a real regression, not acceptable even though the process stayed alive. stdout so far:\n${stdout}`,
      );
    }
    console.log(
      '[sandbox-status-proof] FFI boundary and real rendering proofs both present under a sandboxed launch — zero regression to the existing lifecycle proof.',
    );

    // QNBS-v3: the harness process itself runs in the same ambient/initial user namespace the (unsandboxed-by-design) browser process runs in — comparing a child's namespace against this value is equivalent to comparing it against the browser's own, without needing a second /proc read.
    const ambientUserNs = readUserNsId(process.pid);
    const pids = listMatchingPids();
    const roles = pids
      .map((pid) => ({ pid, role: classifyRole(pid) }))
      .filter((p) => p.role !== null);

    const forbiddenFlagHits = roles
      .map(({ pid, role }) => ({ pid, role, flags: findForbiddenFlags(pid) }))
      .filter((r) => r.flags.length > 0);
    if (forbiddenFlagHits.length > 0) {
      const detail = forbiddenFlagHits
        .map((r) => `pid=${r.pid} role=${r.role} flags=${r.flags.join(',')}`)
        .join('; ');
      throw new Error(
        `sandbox-weakening flag(s) observed on the actual process command line — this would misrepresent what's protected, exactly what the acceptance bar disallows: ${detail}`,
      );
    }

    console.log(
      `[sandbox-status-proof] Observed process tree (${roles.length} matching process(es)):`,
    );
    const evidence = [];
    for (const { pid, role } of roles) {
      const seccomp = readProcStatusField(pid, 'Seccomp');
      const noNewPrivs = readProcStatusField(pid, 'NoNewPrivs');
      const userNs = readUserNsId(pid);
      const distinctUserNs = userNs !== null && userNs !== ambientUserNs;
      console.log(
        `  pid=${pid} role=${role} Seccomp=${seccomp ?? '(unreadable)'} NoNewPrivs=${noNewPrivs ?? '(unreadable)'} ` +
          `user-ns=${userNs ?? '(unreadable)'} distinct-from-ambient=${distinctUserNs}`,
      );
      evidence.push({ pid, role, seccomp, noNewPrivs, distinctUserNs });
    }

    child.kill('SIGTERM');
    const shutdownResult = await Promise.race([exited, sleep(SHUTDOWN_GRACE_MS).then(() => null)]);
    if (!shutdownResult) {
      logStderr('shutdown', stderr);
      throw new Error('process did not exit within the shutdown grace period.');
    }
    // QNBS-v3: accepts either "died from the SIGTERM we sent" or "exited 0 on its own" as clean — same convention as run-launch-cycle-proof.mjs.
    const cleanShutdown = shutdownResult.signal === 'SIGTERM' || shutdownResult.code === 0;
    if (!cleanShutdown) {
      logStderr('shutdown', stderr);
      throw new Error(
        `abnormal exit during shutdown (code=${shutdownResult.code}, signal=${shutdownResult.signal}).`,
      );
    }
    await sleep(ORPHAN_CHECK_GRACE_MS);
    if (processTreeAlive()) {
      throw new Error('orphaned worldscript_host process(es) still running after shutdown.');
    }

    const nonBrowserEvidence = evidence.filter((e) => e.role !== 'browser');
    if (nonBrowserEvidence.length === 0) {
      throw new Error(
        'no renderer/GPU/utility subprocess was observed while the browser was running — this proof requires at least one non-browser process to assert real evidence on, not just the browser process itself.',
      );
    }

    // QNBS-v3: Linux's Seccomp status field is 0=disabled/1=strict/2=filter — Chromium's own seccomp-BPF layer specifically means filter mode (2). Accepting 1 (strict mode, a different and much rarer kernel feature) as BPF evidence would overclaim; a raw non-zero check was a real precision gap flagged on this PR before it could become a false sandbox_smoke=true claim later.
    const seccompBpfFiltered = nonBrowserEvidence.filter((e) => e.seccomp === '2');
    const withDistinctUserNs = nonBrowserEvidence.filter((e) => e.distinctUserNs);

    console.log(
      `[sandbox-status-proof] ${nonBrowserEvidence.length} non-browser process(es) observed; ` +
        `${seccompBpfFiltered.length} with Seccomp=2 (real seccomp-BPF filter mode, layer-2 evidence); ` +
        `${withDistinctUserNs.length} in a user namespace distinct from the ambient one (layer-1 evidence).`,
    );

    if (seccompBpfFiltered.length === 0 && withDistinctUserNs.length === 0) {
      throw new Error(
        'zero layer-1 (namespace) or layer-2 (seccomp-BPF filter, Seccomp=2 specifically) evidence found on any ' +
          'renderer/GPU/utility subprocess — no_sandbox=false did not produce an observable change in process ' +
          'isolation on this runner. Per the acceptance bar in cef-architecture-primer.md, a clean launch alone ' +
          'does not count as proof.',
      );
    }

    console.log(
      '[sandbox-status-proof] OK — real per-process evidence collected for at least one Linux sandbox layer ' +
        '(namespace isolation and/or seccomp-BPF filter mode) on a renderer/GPU/utility subprocess, with zero ' +
        'regression to the existing FFI/rendering lifecycle proof. This is CI-runner feasibility evidence, not a ' +
        'production-packaging sandbox proof — see cef-architecture-primer.md\'s "two separate gates" note. This ' +
        'first attempt intentionally accepts any single non-browser process showing either layer as a diagnostic ' +
        'pass — a stricter per-role (renderer vs. GPU vs. utility) requirement is deferred to the follow-up that ' +
        'actually flips sandbox_smoke to true, once this real evidence is reviewed.',
    );
  } finally {
    // QNBS-v3: unconditional safety net — CodeRabbit-class finding on this PR. Runs whether the try block succeeded, threw before ever attempting graceful shutdown, or threw after it. killAllMatchingProcesses() sweeps the whole binary-path-matching tree (not just the tracked child), same as run-launch-cycle-proof.mjs's crash-reporting-cycle cleanup.
    if (processTreeAlive()) {
      killAllMatchingProcesses();
      await sleep(ORPHAN_CHECK_GRACE_MS);
      if (processTreeAlive()) {
        console.error(
          '[sandbox-status-proof] WARNING — worldscript_host process(es) still running after failure cleanup.',
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(`[sandbox-status-proof] FAIL — ${err.message}`);
  process.exit(1);
});
