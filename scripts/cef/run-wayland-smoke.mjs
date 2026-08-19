#!/usr/bin/env node
/**
 * Best-effort Wayland launch smoke test for the Wave 2 CEF host (roadmap §44.2:
 * "'CEF uses Chromium' is not accepted as proof of Wayland/X11 correctness" — the
 * mandatory run-launch-cycle-proof.mjs only ever runs worldscript_host under Xvfb/X11).
 *
 * This is a genuine feasibility attempt, not a guess: Chromium's own upstream GN
 * default (build/config/ozone.gni, `is_linux` branch) compiles BOTH the x11 and
 * wayland Ozone platforms into every standard Linux build (`ozone_platform_wayland =
 * true`), and CEF's own tools/gn_args.py has no override disabling it — confirmed by
 * reading both files directly, not assumed. What's still genuinely unverified before
 * this script runs is whether the fetched "linux64 minimal" binary distribution
 * actually carries that support through, and whether a headless Weston compositor
 * (the Wayland-side equivalent of Xvfb — no real display/GPU needed) is a viable
 * launch target for it on a stock GitHub Actions runner.
 *
 * Deliberately does NOT touch worldscript_host's build or the already-proven X11
 * proofs — this launches the exact same already-built binary, just under
 * --ozone-platform=wayland against a headless Weston socket instead of Xvfb. The
 * calling CI step is marked continue-on-error so a real "Wayland doesn't work with
 * this CEF distribution/runner" finding is informative, not a regression gate.
 *
 * Run: node scripts/cef/run-wayland-smoke.mjs <binary-path> <url>
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [binaryPath, url] = process.argv.slice(2);

if (!binaryPath || !url) {
  console.error(
    '[wayland-smoke] Usage: node scripts/cef/run-wayland-smoke.mjs <binary-path> <url>',
  );
  process.exit(1);
}

// QNBS-v3: same grace period rationale as run-launch-cycle-proof.mjs's STARTUP_GRACE_MS — CI-runner-speed variance, not a code concern this script has any control over.
const LAUNCH_GRACE_MS = 10000;
const COMPOSITOR_SOCKET_GRACE_MS = 5000;
const FFI_PROOF_LINE = 'rust_core ping = 424242';
const EXPECTED_TITLE_LINE = 'title = WorldScript Studio';
const WAYLAND_SOCKET_NAME = 'wayland-smoke-0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// QNBS-v3: systemd/Wayland both refuse to operate against a XDG_RUNTIME_DIR that isn't mode 0700 and owned by the current user — a real, well-documented requirement, not optional hardening. GitHub Actions runners don't set this by default (no logind session), so it's created explicitly here.
function ensureXdgRuntimeDir() {
  const dir = process.env.XDG_RUNTIME_DIR || '/tmp/wayland-smoke-xdg-runtime';
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

async function main() {
  const xdgRuntimeDir = ensureXdgRuntimeDir();
  const env = { ...process.env, XDG_RUNTIME_DIR: xdgRuntimeDir };

  console.log('[wayland-smoke] Starting headless Weston compositor…');
  // QNBS-v3: Weston's headless backend needs no real display/GPU — the Wayland-side equivalent of Xvfb, same reasoning as run-launch-cycle-proof.mjs uses xvfb-run for X11.
  const weston = spawn(
    'weston',
    ['--backend=headless-backend.so', `--socket=${WAYLAND_SOCKET_NAME}`],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let westonStderr = '';
  weston.stderr.on('data', (chunk) => {
    westonStderr += chunk.toString();
  });

  const socketPath = path.join(xdgRuntimeDir, WAYLAND_SOCKET_NAME);
  const socketDeadline = Date.now() + COMPOSITOR_SOCKET_GRACE_MS;
  while (!fs.existsSync(socketPath) && Date.now() < socketDeadline) {
    await sleep(200);
  }
  if (!fs.existsSync(socketPath)) {
    console.error(`[wayland-smoke] FAIL — Weston did not create ${socketPath} in time.`);
    if (westonStderr) console.error(`[wayland-smoke] Weston stderr:\n${westonStderr}`);
    weston.kill('SIGKILL');
    process.exit(1);
  }
  console.log(`[wayland-smoke] Weston compositor socket ready: ${socketPath}`);

  console.log(`[wayland-smoke] Launching worldscript_host with --ozone-platform=wayland…`);
  const child = spawn(
    binaryPath,
    [`--url=${url}`, '--ozone-platform=wayland', '--enable-logging=stderr', '--v=1'],
    {
      cwd: path.dirname(binaryPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, WAYLAND_DISPLAY: WAYLAND_SOCKET_NAME },
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

  const rendered = await Promise.race([
    (async () => {
      while (!(stdout.includes(FFI_PROOF_LINE) && stdout.includes(EXPECTED_TITLE_LINE))) {
        await sleep(200);
      }
      return true;
    })(),
    exited.then(() => false),
    sleep(LAUNCH_GRACE_MS).then(() => false),
  ]);

  child.kill('SIGKILL');
  weston.kill('SIGKILL');
  try {
    execFileSync('pkill', ['-9', '-f', WAYLAND_SOCKET_NAME], { stdio: 'ignore' });
  } catch {
    // Nothing left matching — fine.
  }

  if (!rendered) {
    console.error(
      `[wayland-smoke] FAIL — did not observe both "${FFI_PROOF_LINE}" and "${EXPECTED_TITLE_LINE}" within ${LAUNCH_GRACE_MS}ms under --ozone-platform=wayland.`,
    );
    console.error(`[wayland-smoke] stdout:\n${stdout || '(empty)'}`);
    console.error(`[wayland-smoke] stderr:\n${stderr || '(empty)'}`);
    process.exit(1);
  }

  console.log(
    '[wayland-smoke] OK — worldscript_host rendered the real production bundle under a headless Weston Wayland compositor (--ozone-platform=wayland), FFI boundary and title both proven.',
  );
}

main().catch((err) => {
  console.error(`[wayland-smoke] FAIL — unexpected error: ${err.message}`);
  process.exit(1);
});
