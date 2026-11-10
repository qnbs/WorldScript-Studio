#!/usr/bin/env node
// QNBS-v3 (#1223): the container image must serve a DOMPurify build that contains the 3.4.17 fixes (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f). The lockfile does not prove what the image serves, so this reads the web bundle extracted from the built image. No DOMPurify build, more than one DOMPurify version, or an older version is a failure; repeated copies of one fixed version are accepted.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isVersionAtLeast } from './pnpm-version-policy.mjs';

export const MINIMUM_DOMPURIFY = '3.4.17';

// DOMPurify sets `version` and then resets `removed` on the same object. Both assignments survive minification (`t.version=`3.4.17`,t.removed=[]`).
const DOMPURIFY_FINGERPRINT =
  /([\w$]+)\.version\s*=\s*(["'`])(\d+\.\d+\.\d+)\2\s*[,;]\s*\1\.removed\s*=\s*\[\]/g;

/** Every DOMPurify version assignment in one bundle file. */
export function dompurifyVersionsIn(text) {
  return [...String(text).matchAll(DOMPURIFY_FINGERPRINT)].map((match) => match[3]);
}

const byVersion = (a, b) => a.localeCompare(b, 'en', { numeric: true });

function bundleErrors(versions, minimum) {
  if (versions.length === 0) return ['no DOMPurify build found in the bundle'];
  const errors = [];
  if (versions.length > 1) {
    errors.push(`more than one DOMPurify version in the bundle: ${versions.join(', ')}`);
  }
  const outdated = versions.filter((version) => !isVersionAtLeast(version, minimum));
  if (outdated.length > 0) {
    errors.push(`DOMPurify ${outdated.join(', ')} is older than the required ${minimum}`);
  }
  return errors;
}

/** @param {{name: string, text: string}[]} files */
export function checkBundleDompurify(files, minimum = MINIMUM_DOMPURIFY) {
  const found = files.flatMap(({ name, text }) =>
    dompurifyVersionsIn(text).map((version) => ({ name, version })),
  );
  const versions = [...new Set(found.map((entry) => entry.version))].sort(byVersion);
  const errors = bundleErrors(versions, minimum);
  return {
    ok: errors.length === 0,
    versions,
    files: [...new Set(found.map((entry) => entry.name))].sort(),
    errors,
  };
}

function readBundle(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .map((path) => ({ name: relative(root, path), text: readFileSync(path, 'utf8') }));
}

function main(root) {
  if (!root) {
    process.stderr.write('usage: node scripts/check-image-bundle.mjs <extracted web root>\n');
    process.exitCode = 2;
    return;
  }
  const result = checkBundleDompurify(readBundle(root));
  for (const error of result.errors) process.stderr.write(`image-bundle: ${error}\n`);
  if (result.ok) {
    process.stdout.write(
      `image-bundle: DOMPurify ${result.versions[0]} (>= ${MINIMUM_DOMPURIFY}) in ${result.files.join(', ')}\n`,
    );
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
