#!/usr/bin/env node
/**
 * Static invariant guard for the vendored y-webrtc fork (`packages/collab-transport`).
 * Wired into the CI security job as `verify:vendor` — fails the build if any of the
 * three SC security patches or the fork bookkeeping drifts. See VENDOR-FORKS.md + issue #60.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const forkDir = join(root, 'packages', 'collab-transport');

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failures.push(name);
};

const cryptoSrc = readFileSync(join(forkDir, 'src', 'crypto.js'), 'utf8');
const webrtcSrc = readFileSync(join(forkDir, 'src', 'y-webrtc.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(forkDir, 'package.json'), 'utf8'));
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');

// ── Invariant 1: PBKDF2 iterations stay at the OWASP 2024 SHA-256 minimum ──────
check(
  'PBKDF2 iterations == 600000',
  /iterations:\s*600000/.test(cryptoSrc) && !/iterations:\s*100000/.test(cryptoSrc),
);

// ── Invariant 2: derived CryptoKeys are non-extractable ───────────────────────
check(
  'deriveKey extractable: false',
  /\n\s*false,\s*\n\s*\['encrypt', 'decrypt'\]/.test(cryptoSrc),
);

// ── Invariant 3: decrypt() returns the rejection (no silent swallow) ──────────
check('decrypt() returns promise.reject()', /return promise\.reject\(/.test(cryptoSrc));

// ── Invariant 4: DataChannel payloads are encrypted/decrypted ─────────────────
check(
  'DataChannel encrypt/decrypt applied',
  /cryptoutils\.encrypt\(/.test(webrtcSrc) && /cryptoutils\.decrypt\(/.test(webrtcSrc),
);

// ── Invariant 5: fork version carries the -scN suffix ─────────────────────────
check('fork version matches <semver>-scN', /^\d+\.\d+\.\d+-sc\d+$/.test(pkg.version));

// ── Invariant 6: no dangling upstream dependency / pnpm patch ─────────────────
const deps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
check('root package.json has no y-webrtc dependency', !('y-webrtc' in deps));
check('pnpm-workspace has no y-webrtc patchedDependency', !workspace.includes('y-webrtc@'));
check('deprecated patch file removed', !existsSync(join(root, 'patches', 'y-webrtc@10.3.0.patch')));

if (failures.length > 0) {
  console.error(`\nverify:vendor FAILED — ${failures.length} invariant(s) violated:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nverify:vendor OK — @domain/collab-transport@${pkg.version} invariants hold.`);
