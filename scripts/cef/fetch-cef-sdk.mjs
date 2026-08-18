#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
/**
 * CEF SDK fetch/verify/extract for the Wave 2 learning harness
 * (docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md §3142, ADR-0020).
 *
 * ADR-0020's own "Consequences" section requires this to be a fetch script, never committed
 * binaries — the SDK is ~300MB compressed / ~1.5GB extracted. Idempotent: a second run with a
 * matching cache is a no-op, so CI can call this on every job without re-downloading each time
 * (pair with actions/cache on CACHE_DIR).
 *
 * Version/checksum are read from cef-version.json, never hardcoded here — bumping the pinned CEF
 * version is a one-file diff, not a code change.
 *
 * Run: node scripts/cef/fetch-cef-sdk.mjs [--cache-dir <path>]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCefPaths } from './cefPaths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pin = JSON.parse(fs.readFileSync(path.join(__dirname, 'cef-version.json'), 'utf8'));

const argCacheDirIdx = process.argv.indexOf('--cache-dir');
const cacheDirArg = argCacheDirIdx !== -1 ? process.argv[argCacheDirIdx + 1] : undefined;
if (argCacheDirIdx !== -1 && (!cacheDirArg || cacheDirArg.startsWith('--'))) {
  throw new Error('[fetch-cef-sdk] --cache-dir requires a directory path');
}
const { cacheDir, archivePath, extractedDir, extractedDirName } = resolveCefPaths(pin, cacheDirArg);
const markerPath = path.join(extractedDir, '.fetch-cef-sdk-verified');

/** @param {string} filePath */
function sha1Of(filePath) {
  const hash = createHash('sha1');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function alreadyVerified() {
  if (!fs.existsSync(markerPath)) return false;
  const marker = fs.readFileSync(markerPath, 'utf8').trim();
  return marker === pin.sha1;
}

async function downloadArchive() {
  const url = `${pin.baseUrl}/${pin.filename}`;
  console.log(
    `[fetch-cef-sdk] Downloading ${url} (${(pin.sizeBytes / 1024 / 1024).toFixed(0)} MB)…`,
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[fetch-cef-sdk] Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(archivePath, buffer);
}

function verifyArchive() {
  const actual = sha1Of(archivePath);
  if (actual !== pin.sha1) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(
      `[fetch-cef-sdk] Checksum mismatch for ${pin.filename}: expected ${pin.sha1}, got ${actual}. ` +
        'Deleted the bad download — re-run to retry, or update cef-version.json if the pin is stale.',
    );
  }
}

function extractArchive() {
  console.log(`[fetch-cef-sdk] Extracting to ${extractedDir}…`);
  fs.rmSync(extractedDir, { recursive: true, force: true });
  // QNBS-v3: shells out to tar (bzip2 support) rather than a JS decompressor — runs once per cache miss, not hot code.
  execFileSync('tar', ['xjf', archivePath, '-C', cacheDir], { stdio: 'inherit' });
  fs.writeFileSync(markerPath, pin.sha1);
}

async function main() {
  // QNBS-v3: enforced here, not just in the package.json wrapper — a direct `node` invocation must not bypass the CI-only disk/RAM guard either.
  if (process.env.CI !== 'true') {
    throw new Error(
      '[fetch-cef-sdk] CI-only on this machine (disk/RAM constraints) — use: gh workflow run cef-learning-harness.yml',
    );
  }

  if (alreadyVerified()) {
    console.log(
      `[fetch-cef-sdk] OK — ${extractedDirName} already fetched and verified (cache hit).`,
    );
    console.log(extractedDir);
    return;
  }

  if (!fs.existsSync(archivePath) || sha1Of(archivePath) !== pin.sha1) {
    await downloadArchive();
    verifyArchive();
  } else {
    console.log('[fetch-cef-sdk] Archive present and checksum-verified; skipping download.');
  }

  extractArchive();
  console.log(
    `[fetch-cef-sdk] OK — fetched CEF ${pin.cefVersion} (${pin.platform}/${pin.distType}).`,
  );
  console.log(extractedDir);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
