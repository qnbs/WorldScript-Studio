#!/usr/bin/env node
/**
 * Shared cache-path computation for the CEF Wave 2 scripts (ADR-0020) — kept in one place so
 * fetch-cef-sdk.mjs and print-cef-version-diagnostics.mjs can never compute a different path for
 * the same pinned SDK.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

/**
 * @param {{filename: string}} pin
 * @param {string} [cacheDirArg]
 */
export function resolveCefPaths(pin, cacheDirArg) {
  const cacheDir = cacheDirArg ? path.resolve(cacheDirArg) : path.join(root, '.cef-cache');
  const archivePath = path.join(cacheDir, pin.filename);
  const extractedDirName = pin.filename.replace(/\.tar\.bz2$/, '');
  const extractedDir = path.join(cacheDir, extractedDirName);
  return { cacheDir, archivePath, extractedDir, extractedDirName };
}
