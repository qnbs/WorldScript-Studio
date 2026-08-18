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
 * Run: node scripts/cef/print-cef-version-diagnostics.mjs <path-to-extracted-cef-dir>
 */
import fs from 'node:fs';
import path from 'node:path';

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

const cefDir = process.argv[2];
if (!cefDir) {
  console.error(
    '[cef-version-diagnostics] Usage: node scripts/cef/print-cef-version-diagnostics.mjs <extracted-cef-dir>',
  );
  process.exit(1);
}

const versionHeaderPath = path.join(cefDir, 'include', 'cef_version.h');
if (!fs.existsSync(versionHeaderPath)) {
  console.error(`[cef-version-diagnostics] Not found: ${versionHeaderPath}`);
  process.exit(1);
}

const text = fs.readFileSync(versionHeaderPath, 'utf8');
// QNBS-v3: separators use [ \t] rather than \s — \s matches \n, so a bare `#define GUARD_H_`
// header-guard line (no value) would otherwise swallow the *next* line as its own "value" and
// silently skip that line's real macro (caught via a synthetic cef_version.h fixture in review).
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

const missing = KNOWN_MACROS.filter((m) => !(m in found));
if (missing.length === KNOWN_MACROS.length) {
  console.error(
    '[cef-version-diagnostics] None of the known macros were found — header format may have changed.',
  );
  process.exit(1);
}
