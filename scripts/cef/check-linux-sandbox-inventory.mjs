#!/usr/bin/env node
/**
 * CEF Linux sandbox feasibility inventory (Wave 2, roadmap Sandbox posture item — "Not yet
 * attempted" in docs/architecture/native-readiness.md).
 *
 * Diagnostic-only, non-invasive — reports real evidence about whether this runner can support
 * Chromium's Linux sandbox, before any attempt to actually enable it (CefSettings.no_sandbox is
 * currently `true` unconditionally, apps/desktop-cef/src/main.cpp, ADR-0020). Never changes
 * worldscript_host's build or runtime behavior.
 *
 * Background (confirmed against CEF's own docs/sandbox_setup.md and Chromium's
 * docs/linux_sandboxing.md before writing this — CEF has no Linux-specific sandbox API, unlike
 * cef_sandbox_win.h/cef_sandbox_mac.h; the sandbox is entirely a Chromium-internal mechanism,
 * toggled only via CefSettings.no_sandbox):
 *   - Layer-1 (process/namespace isolation): the legacy setuid `chrome-sandbox` helper (needs
 *     root ownership + the setuid bit), or the modern unprivileged user-namespaces sandbox
 *     (preferred automatically since Chromium M-43 if the kernel/policy allows it — no setuid
 *     binary needed at all).
 *   - Layer-2 (seccomp-bpf syscall filtering): independent of layer-1, needs Linux kernel >= 3.5.
 *
 * This script checks real, functional evidence for layer-1 feasibility — not just documentation
 * claims — since a sysctl value alone doesn't prove unprivileged namespace creation actually
 * succeeds (AppArmor profiles or container restrictions can block it even when the sysctl says
 * "enabled").
 *
 * Run: node scripts/cef/check-linux-sandbox-inventory.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

console.log('[check-sandbox-inventory] CEF Linux sandbox feasibility inventory:');

const kernelRelease = tryRun('uname', ['-r']);
console.log(`  kernel release: ${kernelRelease ?? '(uname failed)'}`);

// QNBS-v3: this sysctl is a Debian/Ubuntu-specific patch, not present on every distro/kernel —
// its absence is itself informative (means the mainline kernel default applies), not an error.
let sysctlValue = null;
try {
  sysctlValue = fs.readFileSync('/proc/sys/kernel/unprivileged_userns_clone', 'utf8').trim();
  console.log(`  kernel.unprivileged_userns_clone: ${sysctlValue}`);
} catch {
  console.log('  kernel.unprivileged_userns_clone: (sysctl not present on this kernel/distro)');
}

// QNBS-v3: functional test, not just reading the sysctl — AppArmor profiles or container-level
// restrictions (e.g. missing CAP_SYS_ADMIN, seccomp policies on the runner itself) can block
// unprivileged namespace creation even when the sysctl claims it's allowed.
const unshareTest = tryRun('unshare', ['--user', '--pid', '--fork', 'true']);
const unshareWorks = unshareTest !== null;
console.log(
  `  unshare --user --pid --fork (functional test): ${unshareWorks ? 'succeeded' : 'FAILED'}`,
);

// QNBS-v3: existsSync is not a guarantee the following read succeeds (TOCTOU, permissions) —
// an unguarded readFileSync throwing here would abort this entire diagnostic script before it
// even reaches CEF SDK setup. CodeRabbit finding on PR #402.
let aaEnabled = null;
if (fs.existsSync('/sys/module/apparmor/parameters/enabled')) {
  try {
    aaEnabled = fs.readFileSync('/sys/module/apparmor/parameters/enabled', 'utf8').trim();
  } catch {
    aaEnabled = '(read failed)';
  }
}
console.log(`  AppArmor module enabled: ${aaEnabled ?? '(not present)'}`);

console.log(
  `\n[check-sandbox-inventory] Verdict: unprivileged user-namespace sandboxing appears ` +
    `${unshareWorks ? 'FEASIBLE' : 'NOT FEASIBLE'} on this runner (functional test, not just a sysctl read). ` +
    `This is informational only — no sandbox behavior was changed by running this script.`,
);
