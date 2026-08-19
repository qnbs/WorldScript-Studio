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
 * attempt": must show renderer processes actually running under sandbox restrictions, must
 * distinguish namespace isolation (layer 1) from seccomp-BPF (layer 2) since Chromium treats
 * them independently, and must cause zero regression to the existing lifecycle proof (FFI
 * boundary, rendering).
 *
 * PROMOTED (second pass, same PR) from "any non-browser process shows either layer" to a real
 * renderer-specific acceptance test: real CI evidence on this PR showed GPU-process and
 * network-utility processes legitimately run with Seccomp=0 while renderer and storage-utility
 * processes show Seccomp=2 — accepting evidence from ANY non-browser role risked a false
 * sandbox_smoke=true claim satisfied entirely by a GPU/utility process while the renderer itself
 * was never actually verified. At least one observed --type=renderer process must show
 * Seccomp=2 (real seccomp-BPF filter mode, not the unrelated strict mode) for this proof to
 * pass. GPU/utility evidence is still collected and logged (real, useful diagnostic signal) but
 * never asserted on absent a documented per-role requirement.
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
 *     one pass/fail, since a process can show one without the other. Real CI evidence on this PR
 *     also showed the kernel can deny this readlink entirely for a sandboxed renderer — the same
 *     ptrace_may_access-family access-control check that also gates the ptrace(2) syscall itself
 *     (a different, stronger access mode than the plain procfs read this uses, so this denial
 *     corroborates but does not prove the exact mechanism blocking Crashpad's own ptrace attach
 *     — see run-launch-cycle-proof.mjs's crash-reporting investigation). An unreadable namespace
 *     is logged as such and never treated as a fabricated "not distinct" negative result.
 *
 * This proof does NOT establish anything about sandbox-compatible Crashpad renderer-crash-dump
 * generation, which real evidence on this PR shows is a separate, currently-open regression
 * under the real (unmodified) ptrace_scope — see run-launch-cycle-proof.mjs's own
 * --only-crash-reporting proof and step.
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

// QNBS-v3: real diagnostic-experiment mechanism for R-19 (crash-dump-under-sandbox investigation) — space-separated extra Chromium/CEF switches to append to the spawned binary's own argv, e.g. EXTRA_CEF_ARGS="--no-zygote" to test whether bypassing zygote-forking (which never re-executes worldscript_host's own main() for renderer/GPU/utility children) restores per-process crash-handler declarations, WITHOUT ever changing this script's own default (unset) behavior. Never set in the hard-gated steps — CI-diagnostic-step opt-in only.
const extraCefArgs = (process.env.EXTRA_CEF_ARGS ?? '').split(' ').filter(Boolean);

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

// QNBS-v3: /proc/<pid>/cmdline is NUL-separated, not space-separated — splitting on spaces would break on any argument containing one (e.g. a --url value). Chromium's zygote-forked children (renderer/gpu-process/utility) rewrite their own argv memory for ps-friendly display, which collapses the NUL separation into one space-joined string with no NUL bytes at all — real bug found in run-launch-cycle-proof.mjs's identical helper (same PR), applied here too for consistency between both harnesses.
function readCmdline(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const nulSplit = raw.split('\0').filter(Boolean);
    if (nulSplit.length === 1 && nulSplit[0].includes(' ')) {
      return nulSplit[0].split(' ').filter(Boolean);
    }
    return nulSplit;
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
    `[sandbox-status-proof] Launching worldscript_host with sandboxing enabled (no_sandbox=false)${extraCefArgs.length ? `, extra args: ${extraCefArgs.join(' ')}` : ''}…`,
  );
  const child = spawn(
    binaryPath,
    [`--url=${url}`, '--enable-logging=stderr', '--v=1', ...extraCefArgs],
    {
      cwd: path.dirname(binaryPath),
      stdio: ['ignore', 'pipe', 'pipe'],
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

    // QNBS-v3: promoted from "any non-browser process" to a real renderer-specific acceptance test (PR #404 review) — real CI evidence (this same PR) showed GPU-process and network-utility legitimately run with Seccomp=0 while renderer and storage-utility show Seccomp=2, so accepting ANY non-browser process risked a false sandbox_smoke=true from a GPU/utility process alone while the renderer itself was never actually verified. The browser process is intentionally excluded (never sandboxed by Chromium's own design, see this file's header comment); GPU/utility evidence stays diagnostic-only (logged, not asserted on) absent a documented per-role requirement.
    const renderers = evidence.filter((e) => e.role === 'renderer');
    if (renderers.length === 0) {
      throw new Error(
        'no --type=renderer subprocess was observed while the browser was running — this proof requires real renderer-specific evidence, not just any non-browser process (a GPU-process or utility process alone must not be able to satisfy this).',
      );
    }

    // QNBS-v3: Linux's Seccomp status field is 0=disabled/1=strict/2=filter — Chromium's own seccomp-BPF layer specifically means filter mode (2). Accepting 1 (strict mode, a different and much rarer kernel feature) as BPF evidence would overclaim; a raw non-zero check was a real precision gap flagged on this PR before it could become a false sandbox_smoke=true claim later.
    const renderersWithSeccompFilter = renderers.filter((e) => e.seccomp === '2');
    // QNBS-v3: pid/user-ns readability is reported, never asserted on — real evidence from this PR shows the kernel denies readlink(/proc/<pid>/ns/*) for the same access-control reasons it denies Crashpad's ptrace attach (both use ptrace_may_access-family checks), so "unreadable" here is expected kernel-enforced denial, not a harness failure; treating it as a hard negative would be fabricating a result the observation genuinely cannot make.
    const renderersWithDistinctUserNs = renderers.filter((e) => e.distinctUserNs);
    const nonBrowserEvidence = evidence.filter((e) => e.role !== 'browser');

    console.log(
      `[sandbox-status-proof] ${renderers.length} renderer process(es) observed (pids: ${renderers.map((r) => r.pid).join(', ')}); ` +
        `${renderersWithSeccompFilter.length} with Seccomp=2 (real seccomp-BPF filter mode); ` +
        `${renderersWithDistinctUserNs.length} with a user-ns distinct from ambient (where readable — see the unreadable-is-not-negative note above). ` +
        `${nonBrowserEvidence.length} total non-browser process(es) observed (GPU/utility included, diagnostic only, not asserted on).`,
    );

    if (renderersWithSeccompFilter.length === 0) {
      throw new Error(
        `no observed --type=renderer process shows Seccomp=2 (real seccomp-BPF filter mode) — no_sandbox=false did ` +
          `not produce verifiable renderer-specific sandbox enforcement on this runner. Per the acceptance bar in ` +
          `cef-architecture-primer.md, a clean launch alone (or GPU/utility evidence alone) does not count as proof; ` +
          `renderer evidence observed: ${JSON.stringify(renderers.map((r) => ({ pid: r.pid, seccomp: r.seccomp, noNewPrivs: r.noNewPrivs })))}`,
      );
    }

    console.log(
      '[sandbox-status-proof] OK — real renderer-specific sandbox enforcement confirmed (Seccomp=2, real seccomp-BPF ' +
        'filter mode) on at least one observed --type=renderer process, with zero regression to the existing ' +
        'FFI/rendering lifecycle proof. This is CI-runner feasibility evidence, not a production-packaging sandbox ' +
        'proof — see cef-architecture-primer.md\'s "two separate gates" note. This does NOT establish anything about ' +
        'sandbox-compatible Crashpad renderer-crash-dump generation, which is tracked as a separate, currently-open ' +
        "item — see scripts/cef/run-launch-cycle-proof.mjs's --only-crash-reporting proof and its own step.",
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
