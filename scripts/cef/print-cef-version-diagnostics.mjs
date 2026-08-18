#!/usr/bin/env node
/**
 * CEF version diagnostics (docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md §3142 "version diagnostics",
 * ADR-0020).
 *
 * Parses the fetched SDK's include/cef_version.h for its CEF_* / CHROME_VERSION_* #define macros
 * and prints them, so CI has a real, machine-readable record of exactly which CEF/Chromium build
 * a given harness run exercised — not just the pin file's string, which only says what we *asked*
 * for, not what actually landed in the extracted archive.
 *
 * Deliberately tolerant of macro-set drift across CEF versions: reports whichever of the known
 * macro names it finds and does not fail on ones it doesn't, since CEF's exact macro list has
 * changed across releases and this is a diagnostic aid, not a schema contract.
 *
 * Run: node scripts/cef/print-cef-version-diagnostics.mjs [path-to-extracted-cef-dir]
 * With no argument, defaults to the standard `.cef-cache/<pinned-dist>` path that
 * fetch-cef-sdk.mjs extracts to — so this is directly usable after `cef:fetch-sdk`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCefPaths } from './cefPaths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// QNBS-v3: requires BOTH a CEF and Chromium identifying macro — a partial hit doesn't establish which build this is.
const REQUIRED_IDENTIFYING_MACROS = ['CEF_VERSION_MAJOR', 'CHROME_VERSION_MAJOR'];

const KNOWN_MACROS = [
  'CEF_VERSION',
  'CEF_VERSION_MAJOR',
  'CEF_VERSION_MINOR',
  'CEF_VERSION_PATCH',
  'CEF_COMMIT_NUMBER',
  'CEF_COMMIT_HASH',
  'CHROME_VERSION_MAJOR',
  'CHROME_VERSION_MINOR',
  'CHROME_VERSION_BUILD',
  'CHROME_VERSION_PATCH',
];

let cefDir = process.argv[2];
if (!cefDir) {
  const pin = JSON.parse(fs.readFileSync(path.join(__dirname, 'cef-version.json'), 'utf8'));
  cefDir = resolveCefPaths(pin).extractedDir;
  console.log(`[cef-version-diagnostics] No path given — defaulting to ${cefDir}`);
}

const versionHeaderPath = path.join(cefDir, 'include', 'cef_version.h');
if (!fs.existsSync(versionHeaderPath)) {
  console.error(`[cef-version-diagnostics] Not found: ${versionHeaderPath}`);
  process.exit(1);
}

const text = fs.readFileSync(versionHeaderPath, 'utf8');
// QNBS-v3: [ \t] not \s — \s matches \n, so a bare `#define GUARD_H_` line would otherwise swallow the next line as its own value.
const DEFINE_RE = /^#define[ \t]+(\w+)[ \t]+(.+?)[ \t]*$/gm;

/** @type {Record<string, string>} */
const found = {};
for (const match of text.matchAll(DEFINE_RE)) {
  const [, name, value] = match;
  if (name && KNOWN_MACROS.includes(name)) {
    found[name] = value.replace(/^"|"$/g, '');
  }
}

console.log(`[cef-version-diagnostics] ${versionHeaderPath}`);
for (const macro of KNOWN_MACROS) {
  console.log(`  ${macro} = ${found[macro] ?? '(not found)'}`);
}

const missingIdentifying = REQUIRED_IDENTIFYING_MACROS.filter((m) => !(m in found));
if (missingIdentifying.length > 0) {
  console.error(
    `[cef-version-diagnostics] Could not identify the CEF/Chromium build — missing: ${missingIdentifying.join(', ')}. Header format may have changed.`,
  );
  process.exit(1);
}
