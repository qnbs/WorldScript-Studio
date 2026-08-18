#!/usr/bin/env node
/**
 * CEF Linux runtime-dependency inventory (docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md §44.3, ADR-0020).
 *
 * Formalizes the Wave 2 spike's informal dev-machine findings
 * (docs/cef/knowledge/linux-runtime-notes.md) into a real, CI-runnable check. Reports which of
 * CEF's documented runtime shared-library dependencies are present via dpkg, on *this* machine.
 *
 * Deliberately non-fatal by default (exit 0 even with missing packages): this script's job is to
 * produce an honest inventory data point, not to gate CI on a specific distro's package set —
 * that gate belongs to a later packaging wave (§44's clean-machine test), once WorldScript ships
 * an actual installer with declared dependencies. Pass --strict to fail on any missing package
 * once a real compatibility floor has been proven (not yet — see the roadmap warning below).
 *
 * Run: node scripts/cef/check-linux-runtime-deps.mjs [--strict]
 */
import { execFileSync } from 'node:child_process';

// QNBS-v3: list is what CEF's own build docs call out, confirmed present on one dev machine — see docs/cef/knowledge/linux-runtime-notes.md; don't add packages from generic Chromium docs without a real WorldScript test.
const REQUIRED_PACKAGES = [
  'libnss3',
  'libnspr4',
  'libatk1.0-0',
  'libatk-bridge2.0-0',
  'libcups2',
  'libdrm2',
  'libgbm1',
  'libxcomposite1',
  'libxdamage1',
  'libxfixes3',
  'libxrandr2',
  'libxkbcommon0',
  'libpango-1.0-0',
  'libcairo2',
  'libasound2',
  'libgtk-3-0',
  'libx11-xcb1',
  'libxcb1',
];

/** @param {string} pkg */
function dpkgReportsInstalled(pkg) {
  try {
    // QNBS-v3: dpkg -s exits 0 even for a removed package still holding config-files state — only the Status line's "installed" word confirms it's actually present.
    const out = execFileSync('dpkg', ['-s', pkg], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return /^Status:.*\binstalled\b/m.test(out);
  } catch {
    return false;
  }
}

// QNBS-v3: Ubuntu 24.04's 64-bit-time_t transition renamed several of these to a "t64" suffix (confirmed on the real ubuntu-latest CI runner) — check both spellings.
/** @param {string} pkg */
function isInstalled(pkg) {
  return dpkgReportsInstalled(pkg) || dpkgReportsInstalled(`${pkg}t64`);
}

const strict = process.argv.includes('--strict');
const results = REQUIRED_PACKAGES.map((pkg) => ({ pkg, present: isInstalled(pkg) }));
const missing = results.filter((r) => !r.present);

console.log('[check-linux-deps] CEF Linux runtime-dependency inventory:');
for (const { pkg, present } of results) {
  console.log(`  ${present ? '✓' : '✗'} ${pkg}`);
}

if (missing.length > 0) {
  console.log(
    `\n[check-linux-deps] ${missing.length}/${results.length} package(s) missing on this machine: ` +
      missing.map((m) => m.pkg).join(', '),
  );
} else {
  console.log(`\n[check-linux-deps] All ${results.length} documented packages present.`);
}

if (strict && missing.length > 0) {
  console.error('[check-linux-deps] --strict requested and packages are missing — failing.');
  process.exit(1);
}
