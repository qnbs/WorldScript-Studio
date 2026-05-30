#!/usr/bin/env node
/**
 * Static invariant guard for the vendored y-webrtc fork (@domain/collab-transport).
 *
 * Renovate/Dependabot cannot update this fork, so the C-1 security patches in
 * crypto.js have no upstream owner. This script fails CI if any of those patches
 * silently regress, or if the vendored version drifts from the documented baseline.
 * It performs NO network access — purely a source-level assertion (issue #60).
 *
 * Run via `pnpm run verify:vendor` and in the CI security job.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'collab-transport');
const cryptoPath = join(pkgDir, 'src', 'crypto.js');
const pkgPath = join(pkgDir, 'package.json');

const EXPECTED_VERSION = '10.3.0-sc1';

const crypto = readFileSync(cryptoPath, 'utf8');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

/** @type {{ name: string, ok: boolean, detail: string }[]} */
const checks = [];
const assert = (name, ok, detail) => checks.push({ name, ok, detail });

// C-1 patch 1 — PBKDF2 iterations at the OWASP 2024 SHA-256 minimum.
assert(
  'PBKDF2 iterations = 600000',
  /iterations:\s*600000\b/.test(crypto),
  'crypto.js deriveKey must use 600000 iterations (OWASP 2024 minimum)',
);

// C-1 patch 2 — derived AES-GCM key is non-extractable (extractable=false is the
// 4th positional arg to deriveKey, immediately after the {name:'AES-GCM',length:256} block).
assert(
  'derived key extractable = false',
  /length:\s*256\s*\}\s*,\s*false\s*,/.test(crypto),
  'crypto.js deriveKey must pass extractable=false for the AES-GCM key',
);

// C-1 patch 3 — unknown-algorithm path returns the rejection (no silent swallow).
assert(
  'decrypt rejects unknown algorithm',
  /return\s+promise\.reject\(/.test(crypto),
  'crypto.js decrypt() must `return` promise.reject on unknown algorithm',
);

// Version baseline — keeps the fork pinned to the audited upstream tag.
assert(
  `version = ${EXPECTED_VERSION}`,
  pkg.version === EXPECTED_VERSION,
  `package.json version must be ${EXPECTED_VERSION} (got ${pkg.version})`,
);

let failed = false;
for (const c of checks) {
  if (c.ok) {
    process.stdout.write(`  ok   ${c.name}\n`);
  } else {
    failed = true;
    process.stdout.write(`  FAIL ${c.name}\n        → ${c.detail}\n`);
  }
}

if (failed) {
  process.stderr.write(
    '\n[verify-vendor-fork] vendored y-webrtc fork drifted from its security baseline.\n' +
      'Re-apply the C-1 patches and update VENDOR-DIFF.md. See issue #60.\n',
  );
  process.exit(1);
}

process.stdout.write('[verify-vendor-fork] all invariants hold.\n');
