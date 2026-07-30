#!/usr/bin/env node
/**
 * Fails if a doc file states a locale/key count or a release-status claim that no longer matches
 * reality — the drift this audit found repeatedly (ROADMAP.md/TRANSLATION-GUIDE.md/TODO.md/
 * CONTRIBUTING.md/.github/copilot-instructions.md all said "17 locales" after the 17→19 expansion).
 * Historical/dated entries (CHANGELOG-style `## [x.y.z]` headings, or `## vX.Y.Z … RELEASED …`
 * section headings) are exempt — they correctly describe a past state, not the present one.
 *
 * Run: node scripts/check-doc-metrics.mjs
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModules, REF_LANG } from './i18n-locales.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// QNBS-v3: every file the header comment names as a past drift site must actually be scanned —
// CodeRabbit caught .github/copilot-instructions.md missing here, which would let that exact
// regression recur silently past this gate.
const TARGET_FILES = [
  'README.md',
  'ROADMAP.md',
  'TODO.md',
  'docs/TRANSLATION-GUIDE.md',
  'CONTRIBUTING.md',
  '.github/CONTRIBUTING.md',
  '.github/copilot-instructions.md',
];

// QNBS-v3: this repo marks "done" several different ways — Keep-a-Changelog `## [x.y.z]`,
// `## vX.Y.Z … RELEASED …`, a heading suffixed with ✅ (`### Phase 3A … ✅`), a `**Status:** ✅
// Released/Completed …` line just below a plain `## vX.Y — <title>` heading, or a dated heading
// `(YYYY-MM-DD)` — a section carrying ANY of these near its top is a historical snapshot, exempt
// from present-tense metric checks. Independently, this repo's own TODO.md legend ("✅ done") means
// any individual `- ✅ …` bullet is historical regardless of which section it sits in.
const ANY_HEADING = /^#{1,6}\s+/;
const HISTORICAL_MARKER =
  /(✅|\bRELEASED\b|\bDELIVERED\b|\bCompleted\b|\[\d+\.\d+\.\d+\]|\(\d{4}-\d{2}-\d{2})/i;
const DONE_BULLET = /^\s*-\s*✅/;
// QNBS-v3: mirrors DONE_BULLET's "always present-tense regardless of section" rule for open bullets, so a stale ⬜ can't hide in a historical section
const OPEN_BULLET = /^\s*-\s*⬜/;
// QNBS-v3: how many lines below a heading to look for a "**Status:** ✅ Released …" marker that
// applies to the whole section (this repo puts it on its own line, not in the heading text).
const STATUS_LOOKAHEAD = 5;

/**
 * Blank out lines that fall in a historical section (see above), keeping line numbers stable so
 * findings still point at the right place in the ORIGINAL file for anything that isn't blanked.
 */
export function stripHistoricalSections(markdown) {
  const lines = markdown.split('\n');
  const headingIdx = [];
  lines.forEach((line, i) => {
    if (ANY_HEADING.test(line)) headingIdx.push(i);
  });
  headingIdx.push(lines.length); // sentinel so the last section has an end bound

  const historical = new Array(lines.length).fill(false);
  for (let s = 0; s < headingIdx.length - 1; s++) {
    const start = headingIdx[s];
    const end = headingIdx[s + 1];
    const lookahead = lines.slice(start, Math.min(end, start + STATUS_LOOKAHEAD));
    if (lookahead.some((l) => HISTORICAL_MARKER.test(l))) {
      for (let i = start; i < end; i++) historical[i] = true;
    }
  }

  return lines
    .map((line, i) => {
      if (OPEN_BULLET.test(line)) return line; // never strip — see OPEN_BULLET comment above
      return historical[i] || DONE_BULLET.test(line) ? '' : line;
    })
    .join('\n');
}

/** Actual locale count = directories under locales/ (translation-glossary.json is a file, not a locale). */
// QNBS-v3: reads the filesystem directly rather than a hand-maintained constant, so a new locale is picked up automatically instead of going stale like the doc claims this gate exists to catch.
export function getActualLocaleCount() {
  return readdirSync(join(root, 'locales'), { withFileTypes: true }).filter((e) => e.isDirectory())
    .length;
}

/** Actual key count = deduplicated key set across all modules for the reference locale (matches check-i18n-keys.mjs). */
// QNBS-v3: Set-based dedup, not a per-file sum — a key shared by two modules must count once, the exact bug this gate caught in sync-readme-metrics.mjs's own counting logic.
export function getActualKeyCount() {
  const keys = new Set();
  for (const mod of getModules()) {
    const p = join(root, 'locales', REF_LANG, `${mod}.json`);
    const data = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of Object.keys(data)) keys.add(k);
  }
  return keys.size;
}

// QNBS-v3 (F-10): the sole source of truth for the canonical production URL — see constants/brand.ts.
const PRODUCTION_URL_ASSIGNMENT = /export const PRODUCTION_URL = '([^']+)';/;
// QNBS-v3 (CodeRabbit): scheme optional (locales/it/help.json has no `https://` prefix) + hostname-boundary lookaround so `evil.com`-suffixed or `not`-prefixed lookalike hosts can't slip through as a "match".
export const VERCEL_URL_PATTERN =
  /(?<![a-zA-Z0-9-])(?:https?:\/\/)?worldscript-studio[a-z0-9-]*\.vercel\.app\/?(?![a-zA-Z0-9.-])/gi;

/** Read the canonical production URL from constants/brand.ts (the single source of truth). */
export function getCanonicalProductionUrl() {
  const content = readFileSync(join(root, 'constants', 'brand.ts'), 'utf8');
  const m = content.match(PRODUCTION_URL_ASSIGNMENT);
  if (!m) throw new Error('PRODUCTION_URL not found in constants/brand.ts');
  return m[1];
}

/**
 * Scan for any `*.vercel.app` deployment URL that doesn't match the canonical one — the F-10
 * drift (a dead `worldscript-studio-indol.vercel.app` preview URL had leaked into the in-app link
 * and the Italian locale) would have been caught by this on day one.
 */
export function scanForUrlDrift(content, filePath, canonicalUrl) {
  const findings = [];
  const scanned = stripHistoricalSections(content);
  const lines = scanned.split('\n');
  // QNBS-v3 (CodeRabbit): strip the scheme too, so a scheme-less match normalizes to the same key as the always-schemed canonical URL instead of always comparing unequal.
  const normalize = (u) =>
    u
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '')
      .toLowerCase();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(VERCEL_URL_PATTERN)) {
      const found = m[0];
      if (normalize(found) !== normalize(canonicalUrl)) {
        findings.push(
          `${filePath}:${i + 1} — references "${found}", canonical is "${canonicalUrl}" (constants/brand.ts#PRODUCTION_URL): "${line.trim()}"`,
        );
      }
    }
  });
  return findings;
}

/** Latest released version tag (e.g. "1.24.1"), or null if no tags exist (e.g. a shallow clone). */
// QNBS-v3: null (not a thrown error) on a shallow/tagless checkout — callers must treat "no tags" as "skip the PLANNED check", never as a drift finding of its own.
export function getLatestReleasedVersion() {
  try {
    const tag = execSync('git tag --sort=-v:refname', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .find((t) => t.trim().length > 0);
    return tag ? tag.trim().replace(/^v/, '') : null;
  } catch {
    return null;
  }
}

function semverLte(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return true; // equal
}

/**
 * Scan one file's (historical-stripped) content for locale-count / key-count / stale-PLANNED
 * drift against the actual computed values. Returns human-readable finding strings.
 */
// QNBS-v3: regex-scans prose for numeric claims rather than requiring structured metadata — this gate exists precisely because docs drift in free-form text, not in a machine-checked field.
export function scanForDrift(content, filePath, { localeCount, keyCount, latestVersion }) {
  const findings = [];
  const scanned = stripHistoricalSections(content);
  const lines = scanned.split('\n');

  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(\d+)\s+locales?\b/gi)) {
      const found = Number(m[1]);
      if (found !== localeCount) {
        findings.push(
          `${filePath}:${i + 1} — says "${found} locale(s)", actual is ${localeCount}: "${line.trim()}"`,
        );
      }
    }
    for (const m of line.matchAll(/(\d+)\s+(?:i18n\s+)?keys\b/gi)) {
      const found = Number(m[1]);
      if (found !== keyCount) {
        findings.push(
          `${filePath}:${i + 1} — says "${found} keys", actual is ${keyCount}: "${line.trim()}"`,
        );
      }
    }
    if (latestVersion) {
      for (const m of line.matchAll(/v?(\d+\.\d+(?:\.\d+)?)[^\n]*\bPLANNED\b/gi)) {
        const mentioned = m[1];
        if (semverLte(mentioned, latestVersion)) {
          findings.push(
            `${filePath}:${i + 1} — "v${mentioned} … PLANNED" but v${mentioned} <= latest released v${latestVersion}: "${line.trim()}"`,
          );
        }
      }
      // QNBS-v3: catches a stale "⬜ Tag/Release/publish vX.Y.Z" bullet that should have flipped to ✅ once that version shipped
      if (
        OPEN_BULLET.test(line) &&
        /\b(?:tag|tagging|release|releasing|publish|publishing)\b/i.test(line)
      ) {
        for (const m of line.matchAll(/v(\d+\.\d+\.\d+)/gi)) {
          const mentioned = m[1];
          if (semverLte(mentioned, latestVersion)) {
            findings.push(
              `${filePath}:${i + 1} — open "⬜" bullet mentions tag/release/publish of v${mentioned}, but v${mentioned} <= latest released v${latestVersion}: "${line.trim()}"`,
            );
          }
        }
      }
    }
  });

  return findings;
}

// QNBS-v3: exits 1 on any finding — unlike check-coverage-ratchet.mjs this gate is blocking, since a doc claiming a wrong locale/key/release count is actively misleading, not just an opportunity.
// QNBS-v3 (F-10, CodeRabbit follow-up): locales/it/help.json IS included — it's exactly where the F-10 stale-URL drift happened; the in-app link reads the constant directly so it can't drift and isn't listed here.
const URL_CHECK_FILES = ['README.md', 'CLAUDE.md', 'locales/it/help.json'];

function main() {
  const localeCount = getActualLocaleCount();
  const keyCount = getActualKeyCount();
  const latestVersion = getLatestReleasedVersion();
  const canonicalUrl = getCanonicalProductionUrl();

  const allFindings = [];
  for (const relPath of TARGET_FILES) {
    const abs = join(root, relPath);
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue; // file doesn't exist in this checkout — not this gate's concern
    }
    allFindings.push(...scanForDrift(content, relPath, { localeCount, keyCount, latestVersion }));
  }

  for (const relPath of URL_CHECK_FILES) {
    const abs = join(root, relPath);
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    allFindings.push(...scanForUrlDrift(content, relPath, canonicalUrl));
  }

  if (allFindings.length > 0) {
    process.stderr.write(
      `[docs:check] DOC METRICS DRIFT — ${allFindings.length} finding(s):\n${allFindings
        .map((f) => `  - ${f}`)
        .join('\n')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `[docs:check] OK — ${TARGET_FILES.length} files match actual state (${localeCount} locales, ${keyCount} keys${
      latestVersion ? `, latest v${latestVersion}` : ''
    }).\n`,
  );
}

// QNBS-v3: only run the CLI side-effect when invoked directly — stripHistoricalSections/
// scanForDrift/getActual* stay importable (and independently testable) from a unit test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
