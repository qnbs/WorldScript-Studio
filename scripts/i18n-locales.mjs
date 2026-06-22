#!/usr/bin/env node
// QNBS-v3: SSOT bridge for the .mjs i18n scripts. Node ESM scripts cannot import the typed
// `i18n/locales.ts` registry, so they derive the locale + module lists from the filesystem (the
// actual ground truth — a folder with content). A registry-integrity unit test
// (tests/unit/i18n/localesRegistry.test.ts) asserts these match the TS registry, so the two cannot
// drift. Net effect: the locale list is no longer hand-maintained in three separate scripts.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const LOCALES_DIR = join(root, 'locales');
export const REF_LANG = 'en';

// QNBS-v3: locales that are hand-translated / kept as English-anchored stubs and therefore NOT fed to
// the bulk machine-translator. Everything else is MT-eligible. Keeping this here (not per-script)
// means a new language is MT-eligible by default the moment its folder exists.
export const HAND_TRANSLATED = new Set(['en', 'de', 'fr', 'es', 'it', 'ar', 'he']);

/** All locale codes = subdirectories of locales/ that contain a common.json. en first, rest sorted. */
export function getLocales() {
  const codes = readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(LOCALES_DIR, d.name, 'common.json')))
    .map((d) => d.name);
  return [REF_LANG, ...codes.filter((c) => c !== REF_LANG).sort()];
}

/** Module names = *.json files in the reference (en) locale, sorted. */
export function getModules() {
  return readdirSync(join(LOCALES_DIR, REF_LANG))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** Machine-translation-eligible locales = all locales minus the hand-translated set. */
export function getMtLocales() {
  return getLocales().filter((c) => !HAND_TRANSLATED.has(c));
}
