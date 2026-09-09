#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
/**
 * Fails if a doc file states a locale/key count or a release-status claim that no longer matches
 * reality — the drift this audit found repeatedly (ROADMAP.md/TRANSLATION-GUIDE.md/TODO.md/
 * CONTRIBUTING.md/.github/copilot-instructions.md all said "17 locales" after the 17→19 expansion).
 * Historical/dated entries remain exempt from present-tense metric scans, while release truth is
 * checked separately at the latest tag frontier.
 *
 * Run: node scripts/check-doc-metrics.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocales, getModules, REF_LANG } from './i18n-locales.mjs';
import { getVitestTestCaseCount, getVitestTestFileCount } from './test-metrics.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BUNDLE_BUDGET_DOCS = ['README.md', '.github/CI-AUDIT.md'];
const BUNDLE_BUDGET_CONFIG = 'config/bundle-budget.json';

// QNBS-v3: Fail closed on budget drift so current documentation cannot outlive executable limits.
function readBundleBudget() {
  try {
    const budget = JSON.parse(readFileSync(join(root, BUNDLE_BUDGET_CONFIG), 'utf8'));
    const requiredKeys = ['entryKb', 'vendorKb', 'chunkKb', 'wasmKb'];
    if (requiredKeys.some((key) => !Number.isFinite(budget[key]) || budget[key] < 0)) {
      throw new Error('must define non-negative finite KB ceilings');
    }
    return budget;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[bundle:budget] Invalid ${BUNDLE_BUDGET_CONFIG}: ${reason}`);
  }
}

export function scanBundleBudgetTruth(content, filePath, budget) {
  const expected =
    '<!-- bundle-budget:source-of-truth -->\n' +
    `Raw bundle-budget ceilings (KB per uncompressed asset): entry **${budget.entryKb} KB**, vendor **${budget.vendorKb} KB**, other JavaScript **${budget.chunkKb} KB**, and WASM **${budget.wasmKb} KB**.`;
  return content.replaceAll('\r\n', '\n').includes(expected)
    ? []
    : [`${filePath} — bundle-budget statement does not match ${BUNDLE_BUDGET_CONFIG}`];
}

// QNBS-v3: validate localized in-app help claims so user-facing budget guidance cannot drift from CI.
export function scanLocalizedBundleBudgetTruth(content, filePath, budget) {
  try {
    const data = JSON.parse(content);
    const claim = data['help.docs.lazyLoading.content'];
    const budgetSection = typeof claim === 'string' ? claim.slice(claim.lastIndexOf('<li>')) : '';
    const numericClaims = [...budgetSection.matchAll(/\d[\d\s,]*/g)].map((match) => ({
      index: match.index ?? -1,
      value: match[0].replace(/[^\d]/g, ''),
    }));
    const vendorLabel = /\bvendor\b/i.exec(budgetSection);
    const entryLabel = /(?:\bentry\b|\bentrada\b|entrée)/i.exec(budgetSection);
    if (
      numericClaims.length === 2 &&
      vendorLabel?.index !== undefined &&
      entryLabel?.index !== undefined &&
      vendorLabel.index < entryLabel.index &&
      numericClaims[0].value === String(budget.vendorKb) &&
      numericClaims[1].value === String(budget.entryKb)
    ) {
      return [];
    }
  } catch {
    // The regular i18n key/content gates report malformed locale JSON separately.
  }
  return [
    `${filePath} — help.docs.lazyLoading.content bundle-budget claim does not match ${BUNDLE_BUDGET_CONFIG}`,
  ];
}

// QNBS-v3: scan every documented drift site so stale locale, release, and metric claims cannot bypass this gate.
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

// QNBS-v3: validate the same shared Vitest source contract used by README synchronization.
export const getActualTestFileCount = () => getVitestTestFileCount(root);
export const getActualTestCaseCount = () => getVitestTestCaseCount(root);

// QNBS-v3: compare every supported README test-metric form against executable source counts so prose drift fails deterministically.
export function scanReadmeTestMetrics(readme) {
  const expectedFiles = getActualTestFileCount();
  const expectedTests = getActualTestCaseCount();
  const findings = [];
  const patterns = [
    /Tests-(\d+)%2B_%2F_(\d+)_files/g,
    /(\d+)\+ tests \/ (\d+) files/g,
    /Vitest 4\.x \((\d+)\+ tests \/ (\d+) files\)/g,
    /Vitest unit tests \((\d+)\+ tests, (\d+) files\)/g,
    /\*\*(\d+)\+ unit tests\*\* across \*\*(\d+) test files\*\*/g,
  ];
  for (const pattern of patterns) {
    for (const match of readme.matchAll(pattern)) {
      const tests = Number(match[1]);
      const files = Number(match[2]);
      if (tests !== expectedTests || files !== expectedFiles) {
        findings.push(
          `README.md — test metrics report ${tests} tests/${files} files, expected ${expectedTests} tests/${expectedFiles} files from the Vitest source set`,
        );
      }
    }
  }
  return findings;
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
  return [...getTaggedVersions()].sort(semverCompare).at(-1) ?? null;
}

function semverLte(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return true; // equal
}

function semverCompare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function scanReleaseTruth(changelog, packageVersion, taggedVersions) {
  const findings = [];
  const releaseVersions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(
    (match) => match[1],
  );
  const latestTagged = [...taggedVersions].sort(semverCompare).at(-1) ?? null;
  for (const version of releaseVersions) {
    // QNBS-v3: retain historical changelog entries even when old tags were pruned; enforce the tag invariant from the current release frontier onward.
    const isReleaseCandidate = new RegExp(
      `<!--\\s*release-candidate:\\s*v${version.replaceAll('.', '\\.')}(?:\\s|-->)`,
      'i',
    ).test(changelog);
    if (
      latestTagged &&
      !taggedVersions.has(version) &&
      semverCompare(version, latestTagged) >= 0 &&
      !isReleaseCandidate
    ) {
      findings.push(
        `CHANGELOG.md — dated release [${version}] has no matching git tag v${version}; move it to [Unreleased] or create the release tag after review`,
      );
    }
  }
  if (latestTagged && semverCompare(packageVersion, latestTagged) < 0) {
    findings.push(
      `package.json — version ${packageVersion} is older than the latest git tag v${latestTagged}`,
    );
  }
  if (
    latestTagged &&
    semverCompare(packageVersion, latestTagged) > 0 &&
    !/^## \[Unreleased\]/m.test(changelog)
  ) {
    findings.push(
      `CHANGELOG.md — package.json version ${packageVersion} is newer than latest git tag v${latestTagged}, but no [Unreleased] section exists`,
    );
  }
  return findings;
}

/**
 * A version badge may advertise the current development line, but must not present an untagged
 * version as a released version. Keep this separate from prose drift so the README convention is
 * explicit and testable.
 */
export function scanReadmeReleaseTruth(readme, taggedVersions) {
  const findings = [];
  const latestTagged = [...taggedVersions].sort(semverCompare).at(-1) ?? null;
  if (!latestTagged) return findings;

  // QNBS-v3: extract each badge label independently so a valid development badge cannot hide a later invalid release badge on the same line.
  const badgePattern = /\b(?:Next|Release|Version|Current)[-_ ]v?(\d+\.\d+\.\d+)/i;
  const getBadgeTexts = (line) => {
    const badgeTexts = [];
    for (const match of line.matchAll(/!\[([^\]]*)\]/g)) badgeTexts.push(match[1]);
    for (const match of line.matchAll(/<img\b[^>]*\balt=(['"])(.*?)\1[^>]*>/gi)) {
      badgeTexts.push(match[2]);
    }
    for (const match of line.matchAll(/\b(?:Next|Release|Version|Current)[-_ ]v?\d+\.\d+\.\d+/gi)) {
      badgeTexts.push(match[0]);
    }
    return [...new Set(badgeTexts)];
  };
  for (const [index, line] of readme.split('\n').entries()) {
    for (const badgeText of getBadgeTexts(line)) {
      const match = badgeText.match(badgePattern);
      if (!match || /\b(?:next|unreleased|development|dev|pre[- ]?release)\b/i.test(badgeText))
        continue;
      const version = match[1];
      // QNBS-v3: allow the release badge before its matching tag is created after the release PR merges.
      const isReleaseCandidate = new RegExp(
        `<!--\\s*release-candidate:\\s*v${version.replaceAll('.', '\\.')}(?:\\s|-->)`,
        'i',
      ).test(readme);
      if (!taggedVersions.has(version) && !isReleaseCandidate) {
        findings.push(
          `README.md:${index + 1} — release badge advertises v${version}, but no matching git tag exists`,
        );
      }
    }
  }
  return findings;
}

// QNBS-v3 (audit F-2): shared by the presence check below and the completeness check further
// down — both need the raw [Unreleased] section text with HTML comments stripped.
function getUnreleasedSectionText(changelog) {
  const heading = /^## \[Unreleased\]\s*$/m.exec(changelog);
  if (!heading) return '';
  const afterHeading = changelog.slice(heading.index + heading[0].length);
  const nextHeading = afterHeading.search(/^##\s/m);
  const section = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  return section.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}

function hasMeaningfulUnreleasedContent(changelog) {
  const section = getUnreleasedSectionText(changelog);
  return section.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('<!--') && !trimmed.startsWith('###');
  });
}

// QNBS-v3 (audit F-2): a single doc-sync bullet previously satisfied hasMeaningfulUnreleasedContent
// forever, letting arbitrarily many later feat/fix/perf commits go undocumented — the exact gap
// this audit found (13 of 13 real post-tag commits undocumented). Governed commits must each be
// referenced by PR number OR a recognizable subject slug, not merely "some content exists."
const GOVERNED_COMMIT_TYPE = /^(?:feat|fix|perf)(?:\([^)]*\))?!?:\s*/i;
const TRAILING_PR_REF = /\(#(\d+)\)\s*$/;
const SLUG_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'from',
  'at',
  'by',
  'is',
  'are',
  'this',
  'that',
  'not',
]);
// QNBS-v3: a commit not merged via the standard squash flow (no trailing "(#NNN)") has nothing to
// key off but its own wording — require most of a bounded set of its most identifying words to
// appear in [Unreleased], rather than an exact-sentence match this file's other scanners avoid.
const SLUG_WORD_COUNT = 6;
const SLUG_MATCH_RATIO = 0.6;

function significantSlugWords(description) {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !SLUG_STOP_WORDS.has(word))
    .slice(0, SLUG_WORD_COUNT);
}

// QNBS-v3 (coderabbit/CodeAnt): a bare String.includes let "#65" incorrectly satisfy a check for
// "#656" (and vice versa) since one is a substring of the other — require a non-digit boundary on
// both sides so only the exact PR number counts.
function isReferencedByPrNumber(prNumber, unreleasedSection) {
  return new RegExp(`(?:^|\\D)#${prNumber}(?!\\d)`).test(unreleasedSection);
}

// QNBS-v3 (codex): a Markdown bullet may wrap across several physical lines — join a bullet's own
// continuation lines into one entry so slug-matching sees the whole thought, not a fragment.
function splitUnreleasedEntries(unreleasedSection) {
  const entries = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) entries.push(current.join(' '));
    current = [];
  };
  for (const rawLine of unreleasedSection.split('\n')) {
    const line = rawLine.trim();
    if (/^-\s/.test(line)) {
      flush();
      current.push(line);
    } else if (current.length > 0 && line !== '') {
      current.push(line);
    } else if (line === '') {
      flush();
    }
  }
  flush();
  return entries;
}

// QNBS-v3 (codex): the set of entry indices a given commit's slug could match — match ratio is
// computed PER changelog entry (see findUndocumentedGovernedCommits's header comment for why).
function candidateEntryIndices(subject, unreleasedEntries) {
  const description = subject.replace(GOVERNED_COMMIT_TYPE, '').replace(TRAILING_PR_REF, '');
  const words = significantSlugWords(description);
  if (words.length === 0) return [];
  return unreleasedEntries.flatMap((entry, index) => {
    const matched = words.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(entry));
    return matched.length / words.length >= SLUG_MATCH_RATIO ? [index] : [];
  });
}

// QNBS-v3 (codex): unlike an entry merely held by another slug-matched commit, a reserved entry can never be freed up via recursive reassignment.
const RESERVED_ENTRY = -2;

// QNBS-v3 (codex): try to (re)assign `commitIndex` an entry, freeing up its current entry (via
// recursive reassignment) if every candidate is already claimed by a commit that itself has
// another option — standard Kuhn's-algorithm augmenting path for maximum bipartite matching.
function tryAssignEntry(commitIndex, adjacency, entryOwner, visited) {
  for (const entryIndex of adjacency[commitIndex]) {
    if (visited.has(entryIndex)) continue;
    visited.add(entryIndex);
    const currentOwner = entryOwner[entryIndex];
    if (currentOwner === RESERVED_ENTRY) continue;
    if (currentOwner === -1 || tryAssignEntry(currentOwner, adjacency, entryOwner, visited)) {
      entryOwner[entryIndex] = commitIndex;
      return true;
    }
  }
  return false;
}

// QNBS-v3 (codex): greedily claiming the FIRST matching entry per commit is order-dependent — a
// fully documented changelog could be wrongly rejected depending only on which commit happens to
// be checked first (e.g. two entries "Alpha beta gamma delta" / "Alpha beta epsilon zeta" against
// subjects "alpha beta gamma delta epsilon zeta" then "alpha beta gamma delta": greedy claiming in
// that order leaves the second unmatched, even though swapping which entry each takes documents
// both). A maximum bipartite matching (Kuhn's algorithm) finds the best possible assignment
// regardless of input order, so this mandatory pre-push/CI check never blocks already-complete
// history on an accident of commit ordering.
function computeMaxSlugMatching(subjects, entries, reservedEntryIndices = new Set()) {
  const adjacency = subjects.map((subject) => candidateEntryIndices(subject, entries));
  const entryOwner = new Array(entries.length).fill(-1);
  reservedEntryIndices.forEach((entryIndex) => {
    entryOwner[entryIndex] = RESERVED_ENTRY;
  });
  const matchedSubjects = new Array(subjects.length).fill(false);
  for (let commitIndex = 0; commitIndex < subjects.length; commitIndex++) {
    if (tryAssignEntry(commitIndex, adjacency, entryOwner, new Set())) {
      matchedSubjects[commitIndex] = true;
    }
  }
  return matchedSubjects;
}

// QNBS-v3 (codex, P1): an un-numbered commit observed while HEAD isn't `main` is, in practice,
// either a rare old direct-push commit or one of THIS branch's own not-yet-squashed intermediate
// commits (whether pushed to an open PR, or still only local, e.g. under the mandatory pre-push
// hook mid-review), which cannot reference itself in [Unreleased] in advance. Exempting only
// un-numbered commits — not every governed commit, and never a numbered one — still enforces full
// completeness for an already-numbered commit sitting in the same range from a separate,
// already-merged PR, in every context.
// QNBS-v3 (codex): a branch-local commit's trailing "(#NNN)" may be an in-flight issue reference rather than the real PR number GitHub only appends at squash time, so isBranchLocal skips the exact-PR-match path entirely instead of trusting that number.
// QNBS-v3 (CodeScene): extracted so findUndocumentedGovernedCommits stays a flat loop with zero nested conditionals — returns 'documented', 'undocumented', or 'needsSlugCheck' for one subject.
function classifyGovernedCommit(subject, unreleasedSection, isFeatureBranchContext, isBranchLocal) {
  const prMatch = TRAILING_PR_REF.exec(subject);
  if (prMatch && !isBranchLocal) {
    return isReferencedByPrNumber(prMatch[1], unreleasedSection) ? 'documented' : 'undocumented';
  }
  return isFeatureBranchContext ? 'documented' : 'needsSlugCheck';
}

// QNBS-v3 (codex): reserves a numbered commit's entry so it can't silently double as an unrelated commit's own slug-matched documentation — an entry bundling several PR numbers is reserved once per number, which is idempotent since they all resolve to the same index.
function reserveEntryForNumberedCommit(prNumber, entries, reservedEntryIndices) {
  const entryIndex = entries.findIndex((entry) => isReferencedByPrNumber(prNumber, entry));
  if (entryIndex === -1) return;
  reservedEntryIndices.add(entryIndex);
}

function findUndocumentedGovernedCommits(
  postReleaseCommitSubjects,
  unreleasedSection,
  isFeatureBranchContext,
  branchLocalCount = 0,
) {
  const entries = splitUnreleasedEntries(unreleasedSection);
  const undocumented = [];
  const slugCandidates = [];
  const reservedEntryIndices = new Set();
  for (let index = 0; index < postReleaseCommitSubjects.length; index++) {
    const subject = postReleaseCommitSubjects[index];
    if (!GOVERNED_COMMIT_TYPE.test(subject)) continue;
    const isBranchLocal = index < branchLocalCount;
    const prMatch = TRAILING_PR_REF.exec(subject);
    const status = classifyGovernedCommit(
      subject,
      unreleasedSection,
      isFeatureBranchContext,
      isBranchLocal,
    );
    if (status === 'undocumented') undocumented.push(subject);
    if (status === 'needsSlugCheck') slugCandidates.push(subject);
    if (status === 'documented' && prMatch && !isBranchLocal)
      reserveEntryForNumberedCommit(prMatch[1], entries, reservedEntryIndices);
  }
  const matched = computeMaxSlugMatching(slugCandidates, entries, reservedEntryIndices);
  slugCandidates.forEach((subject, index) => {
    if (!matched[index]) undocumented.push(subject);
  });
  return undocumented;
}

/**
 * Return post-release commit subjects when the checkout has enough history to answer reliably.
 * A tagless or shallow checkout intentionally returns null, so CI does not turn missing history
 * into a false release failure.
 */
export function getPostReleaseCommitSubjects(repositoryRoot = root) {
  const taggedVersions = getTaggedVersions(repositoryRoot);
  const latestTagged = [...taggedVersions].sort(semverCompare).at(-1);
  if (!latestTagged) return null;
  try {
    const output = execFileSync('git', ['log', '--format=%s', `v${latestTagged}..HEAD`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((subject) => subject.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

// QNBS-v3 (codex): checks the branch name directly (not just GITHUB_EVENT_NAME) so the un-numbered-commit exemption also covers a local pre-push run, but fails closed on detached HEAD (`git rev-parse --abbrev-ref HEAD` prints "HEAD" there, actions/checkout's default for every event including push) so push-to-main enforcement never silently weakens.
export function isOnFeatureBranch(repositoryRoot = root) {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch !== '' && branch !== 'HEAD' && branch !== 'main';
  } catch {
    return false;
  }
}

// QNBS-v3 (codex): tries origin/main first (what CI actually has) and falls back to a local main so this still resolves in a plain developer clone.
function resolveMainBranchPoint(repositoryRoot) {
  for (const ref of ['origin/main', 'main']) {
    try {
      return execFileSync('git', ['merge-base', 'HEAD', ref], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Try the next candidate ref below.
    }
  }
  return null;
}

// QNBS-v3 (codex): a branch-local commit's trailing "(#NNN)" may still be an in-flight issue reference, not yet the real PR number GitHub appends at squash time, so counting how many of the newest post-tag commits sit above the main branch point lets the caller exempt exactly those from the exact-PR-match rule.
export function getBranchLocalCommitCount(repositoryRoot = root) {
  const branchPoint = resolveMainBranchPoint(repositoryRoot);
  if (!branchPoint) return 0;
  try {
    const output = execFileSync('git', ['rev-list', '--count', `${branchPoint}..HEAD`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return Number.parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// QNBS-v3: isFeatureBranchContext deliberately has a plain `false` default, not one read from
// process.env/git here — an env var is ambiently visible to the Vitest process itself when the
// whole suite runs inside a GitHub Actions pull_request-triggered job (not just this gate's own
// CLI step), so a default read at this pure-function boundary silently changed every test's
// behavior based on which CI context ran it. Only main()'s real CLI invocation below computes the
// actual value (from GITHUB_EVENT_NAME and/or the checked-out branch not being `main` — see
// isOnFeatureBranch below, which covers local `pnpm run ci:prepush` on a feature branch too, not
// just GitHub Actions pull_request jobs); tests always get a deterministic, explicitly-passed value.
export function scanUnreleasedTruth(
  changelog,
  postReleaseCommitSubjects,
  packageVersion,
  taggedVersions,
  isFeatureBranchContext = false,
  branchLocalCount = 0,
) {
  if (!postReleaseCommitSubjects || postReleaseCommitSubjects.length === 0) return [];
  const candidateVersion = changelog.match(
    /<!--\s*release-candidate:\s*v(\d+\.\d+\.\d+)(?:\s|-->)/i,
  )?.[1];
  const latestTagged = taggedVersions ? [...taggedVersions].sort(semverCompare).at(-1) : null;
  const isActiveUntaggedCandidate =
    candidateVersion &&
    packageVersion &&
    taggedVersions &&
    latestTagged &&
    candidateVersion === packageVersion &&
    !taggedVersions.has(candidateVersion) &&
    semverCompare(candidateVersion, latestTagged) > 0;
  // QNBS-v3: only the current untagged release candidate may defer Unreleased history until merge-time tagging.
  if (isActiveUntaggedCandidate) return [];
  if (!hasMeaningfulUnreleasedContent(changelog)) {
    return [
      `CHANGELOG.md — ${postReleaseCommitSubjects.length} commit(s) exist after the latest release tag, but [Unreleased] is empty`,
    ];
  }
  const unreleasedSection = getUnreleasedSectionText(changelog);
  const undocumented = findUndocumentedGovernedCommits(
    postReleaseCommitSubjects,
    unreleasedSection,
    isFeatureBranchContext,
    branchLocalCount,
  );
  if (undocumented.length === 0) return [];
  return [
    `CHANGELOG.md — [Unreleased] does not reference ${undocumented.length} post-tag feat/fix/perf commit(s) by PR number or subject: ${undocumented.map((s) => `"${s}"`).join('; ')}`,
  ];
}

/**
 * @param {string} [repositoryRoot]
 * @returns {string}
 */
export function resolveGitCommonDir(repositoryRoot = root) {
  // QNBS-v3: linked worktrees require resolving gitdir and commondir before tag discovery.
  const dotGit = join(repositoryRoot, '.git');
  if (!existsSync(dotGit)) return dotGit;
  if (statSync(dotGit).isDirectory()) return dotGit;

  const gitdirLine = readFileSync(dotGit, 'utf8').trim();
  const match = /^gitdir:\s*(.+)$/i.exec(gitdirLine);
  if (!match) return dotGit;

  const gitDir = resolve(repositoryRoot, match[1]);
  const commondirPath = join(gitDir, 'commondir');
  if (!existsSync(commondirPath)) return gitDir;
  const commondir = readFileSync(commondirPath, 'utf8').trim();
  return commondir ? resolve(gitDir, commondir) : gitDir;
}

/**
 * @param {string} [repositoryRoot]
 * @returns {Set<string>}
 */
export function getTaggedVersions(repositoryRoot = root) {
  const refs = new Set();
  const gitDir = resolveGitCommonDir(repositoryRoot);
  const packedRefs = join(gitDir, 'packed-refs');
  if (existsSync(packedRefs)) {
    for (const line of readFileSync(packedRefs, 'utf8').split('\n')) {
      const match = line.match(/^[0-9a-f]+ refs\/tags\/(v\d+\.\d+\.\d+)$/);
      if (match) refs.add(match[1].slice(1));
    }
  }
  const tagsRoot = join(gitDir, 'refs', 'tags');
  const collectLooseTags = (directory, prefix = '') => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collectLooseTags(path, name);
      else if (/^v\d+\.\d+\.\d+$/.test(name)) refs.add(name.slice(1));
    }
  };
  collectLooseTags(tagsRoot);
  return refs;
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

// QNBS-v3: (audit F-1) reject a live/pending-remediation claim near a bare PR number in the two
// security-status docs unless that same PR number also carries its actual closed/merged state
// nearby — a stale "PR #356 is the active remediation" survived weeks after #356 closed because
// nothing checked it. Deliberately scoped to these two files, not repo-wide: a blanket rule would
// also reject the legitimate historical CHANGELOG entry, ADR narrative, and already-qualified
// ROADMAP citations of the same PR elsewhere in the repo.
const SECURITY_STATUS_DOCS = ['docs/SECURITY-THREAT-MODEL.md', 'docs/IDB-ENCRYPTION.md'];
// QNBS-v3 (coderabbit): tolerate an inline-code span around the digits ("PR `#356`"), not just a
// markdown-link bracket — both are real Markdown ways to format a PR reference.
const PR_REFERENCE = /\[?PR\s*`?#(\d+)`?\]?/gi;
// QNBS-v3 (codex): order-independent — catches "PR #N is the active remediation", "the active
// remediation is PR #N", "PR #N remains the active remediation", "pending PR #N", "pending on
// PR #N", "in progress on PR #N", etc. Proximity to a PR reference (not fixed word order) is what
// makes a phrase a live-status CLAIM rather than incidental prose.
const LIVE_STATUS_TRIGGER = /\bactive remediation\b|\bpending\b|\bin progress\b/gi;
const STATUS_QUALIFIER_WORD = 'closed|merged|superseded';
const STATUS_QUALIFIER_RE = new RegExp(`\\b(?:${STATUS_QUALIFIER_WORD})\\b`, 'gi');
// QNBS-v3 (codex): a qualifier word only proves a completed status when it isn't negated
// ("is not closed", "has not been closed", "is not yet closed") or prospective ("will be merged",
// "may be merged") — checked for PRESENCE anywhere in the short lookback immediately before the
// match, not requiring exact adjacency, so common compound/auxiliary forms are covered without
// attempting a full negation-scope parser (a known, bounded best-effort heuristic, matching this
// file's existing "crude but sufficient" sentence-split rationale).
const QUALIFIER_NEGATION_OR_FUTURE_WORDS =
  /\b(?:not|never|isn't|won't|will|would|should|may|might|could|going to)\b/i;
// QNBS-v3 (codex): a live-status TRIGGER phrase negated or "no longer" true isn't a live claim at
// all ("is not the active remediation", "no longer the active remediation").
const TRIGGER_NEGATION_WORDS = /\b(?:not|never|no longer|isn't)\b/i;
const NEGATION_LOOKBACK = 40;
const PROXIMITY_WINDOW = 60;
// QNBS-v3 (codex): an unordered/ordered Markdown list marker — same isolation reasoning as table
// rows below.
const LIST_ITEM_MARKER = /^(?:[-*+]|\d+\.)\s+/;

// QNBS-v3 (CodeAnt): group physical lines into Markdown paragraphs (blank-line-delimited) before
// matching — a naive per-line split let a status claim split across a soft-wrapped line evade
// detection entirely. QNBS-v3 (codex): a Markdown table row or list item is its own logical unit
// even though consecutive rows/items have no blank line between them — joining them let a
// live-status claim in one row/item absorb an unrelated row/item's qualifier (or vice versa).
function splitIntoParagraphs(content) {
  const paragraphs = [];
  let buffer = [];
  let startLine = 0;
  const flush = () => {
    if (buffer.length > 0) {
      paragraphs.push({ text: buffer.join(' '), startLine: startLine + 1 });
      buffer = [];
    }
  };
  content.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
    } else if (trimmed.startsWith('|')) {
      // QNBS-v3 (codex): a table row is always a single physical line in standard Markdown — it
      // never wraps — so push it immediately as its own unit, unlike a list item below.
      flush();
      paragraphs.push({ text: trimmed, startLine: i + 1 });
    } else if (LIST_ITEM_MARKER.test(trimmed)) {
      // QNBS-v3 (coderabbit): a new list item starts a new unit, but its own text may still
      // soft-wrap across the following physical line(s) — buffer it like prose (don't push
      // immediately) and let the next marker/table-row/blank line flush it.
      flush();
      startLine = i;
      buffer.push(trimmed);
    } else {
      if (buffer.length === 0) startLine = i;
      buffer.push(trimmed);
    }
  });
  flush();
  return paragraphs;
}

// QNBS-v3 (codex): a semicolon does not end a sentence — splitting on it separated a claim from
// its own qualifying clause (e.g. "PR #N is the active remediation; it was later closed."). Only
// a period genuinely ends a sentence here; the character-proximity window below is what actually
// bounds how far a qualifier/trigger may be from a PR reference, not this split.
function splitIntoSentences(paragraph) {
  return paragraph.split(/(?<=\.)\s+/);
}

// QNBS-v3 (codex): a bracketed "#NNN" whose link target is a /pull/NNN URL (the same bare
// shorthand style already used for issue links like "[#358](.../issues/358)" in these exact two
// docs) is a real PR reference with no literal "PR" text — normalize it to include "PR" BEFORE
// the URL is stripped below, since PR_REFERENCE needs the URL gone but the "PR" word present. The
// \2 backreference ties the link text's number to the URL's /pull/ number so a mismatched pair
// (accidentally or adversarially) isn't misattributed.
function normalizePullShorthand(text) {
  return text.replace(/\[(#(\d+))\]\((?:[^)]*\/pull\/\2)\)/gi, '[PR $1]');
}

// QNBS-v3 (codex): a markdown link's URL (github.com/.../pull/NNN) adds length between a PR
// reference and its surrounding wording without adding meaning — strip it before measuring
// proximity, so a long URL can't push a genuinely adjacent trigger/qualifier word out of window.
function stripLinkUrls(text) {
  return normalizePullShorthand(text).replace(/\]\([^)]*\)/g, ']');
}

// QNBS-v3 (codex): associate a word occurrence with its NEAREST PR reference by character
// distance, not "any PR reference within a fixed window" — a raw-window check let a short,
// unrelated PR's qualifier suppress a different PR's live claim when both sat close together
// (e.g. "[PR #999] is the active remediation, unlike [PR #111], closed.").
function nearestPrNumber(position, prRefs) {
  let best = null;
  let bestDistance = Infinity;
  for (const ref of prRefs) {
    const distance = position < ref.index ? ref.index - position : Math.max(0, position - ref.end);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ref.prNumber;
    }
  }
  return bestDistance <= PROXIMITY_WINDOW ? best : null;
}

function findPrReferences(sentence) {
  return [...sentence.matchAll(PR_REFERENCE)].map((m) => ({
    index: m.index,
    end: m.index + m[0].length,
    prNumber: m[1],
  }));
}

// QNBS-v3 (coderabbit/codex): a negation word belonging to an EARLIER clause must not scope over
// this match ("... is not encrypted, so PR #N is the active remediation" — the "not" modifies
// "encrypted", not "active remediation"). Truncate the raw window at the last clause-separating
// comma/semicolon/colon before the match.
function lookback(sentence, matchIndex) {
  const window = sentence.slice(Math.max(0, matchIndex - NEGATION_LOOKBACK), matchIndex);
  const boundary = Math.max(
    window.lastIndexOf(','),
    window.lastIndexOf(';'),
    window.lastIndexOf(':'),
  );
  return boundary === -1 ? window : window.slice(boundary + 1);
}

// QNBS-v3 (codex): "is not closed" / "will be merged" don't assert a completed status — only a
// qualifier that isn't negated or prospective actually proves the PR is done.
function isNegatedOrProspectiveQualifier(sentence, matchIndex) {
  return QUALIFIER_NEGATION_OR_FUTURE_WORDS.test(lookback(sentence, matchIndex));
}

// QNBS-v3 (codex): "is not the active remediation" / "no longer the active remediation" don't
// assert live status at all — the trigger phrase itself is negated away.
function isNegatedTrigger(sentence, matchIndex) {
  return TRIGGER_NEGATION_WORDS.test(lookback(sentence, matchIndex));
}

// QNBS-v3 (CodeScene): extracted so scanSecurityDocPrStatus itself stays a flat, shallow loop —
// each of these small helpers owns exactly one nested loop+conditional, not three stacked in one.
function collectQualifiedPrs(sentence, prRefs) {
  const qualifiedPrs = new Set();
  for (const m of sentence.matchAll(STATUS_QUALIFIER_RE)) {
    const nearest = nearestPrNumber(m.index, prRefs);
    if (nearest !== null && !isNegatedOrProspectiveQualifier(sentence, m.index)) {
      qualifiedPrs.add(nearest);
    }
  }
  return qualifiedPrs;
}

function collectUnqualifiedClaims(sentence, prRefs, qualifiedPrs) {
  const claims = new Set();
  for (const m of sentence.matchAll(LIVE_STATUS_TRIGGER)) {
    const nearest = nearestPrNumber(m.index, prRefs);
    if (nearest !== null && !qualifiedPrs.has(nearest) && !isNegatedTrigger(sentence, m.index)) {
      claims.add(nearest);
    }
  }
  return claims;
}

function findUnqualifiedClaimsInSentence(sentence) {
  const prRefs = findPrReferences(sentence);
  if (prRefs.length === 0) return [];
  const qualifiedPrs = collectQualifiedPrs(sentence, prRefs);
  return [...collectUnqualifiedClaims(sentence, prRefs, qualifiedPrs)];
}

// QNBS-v3 (codex): an HTML comment or fenced code block is never rendered prose — a literal
// example inside one isn't a live assertion about a real PR. Blank out matched spans (keep
// newlines) rather than remove lines, so line numbers stay stable for the findings below.
// Known, accepted limitation: a single-backtick inline-code SPAN is deliberately not stripped —
// PR_REFERENCE needs backtick tolerance for a real "PR `#356`" citation, and distinguishing that
// from a whole illustrative phrase wrapped in one backtick pair isn't attempted here.
function stripNonProseMarkdown(content) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return content.replace(/<!--[\s\S]*?-->/g, blank).replace(/```[\s\S]*?```/g, blank);
}

export function scanSecurityDocPrStatus(content, filePath) {
  const findings = [];
  const prose = stripNonProseMarkdown(content);
  for (const { text: paragraph, startLine } of splitIntoParagraphs(prose)) {
    const compact = stripLinkUrls(paragraph);
    for (const sentence of splitIntoSentences(compact)) {
      for (const prNumber of findUnqualifiedClaimsInSentence(sentence)) {
        findings.push(
          `${filePath}:${startLine} — asserts a live/pending remediation status near PR #${prNumber} without stating that PR's actual closed/merged state: "${sentence.trim()}"`,
        );
      }
    }
  }
  return findings;
}

// QNBS-v3: exits 1 on any finding — unlike check-coverage-ratchet.mjs this gate is blocking, since a doc claiming a wrong locale/key/release count is actively misleading, not just an opportunity.
// QNBS-v3 (F-10, CodeRabbit follow-up): locales/it/help.json IS included — it's exactly where the F-10 stale-URL drift happened; the in-app link reads the constant directly so it can't drift and isn't listed here.
const URL_CHECK_FILES = ['README.md', 'CLAUDE.md', 'locales/it/help.json'];

// QNBS-v3 (CodeFactor): extracted so main() is a flat sequence of calls instead of five near-identical read/scan loops, each with its own try/catch for a missing file.
function scanRequiredFiles(relPaths, scanFn, missingFindingFor) {
  const findings = [];
  for (const relPath of relPaths) {
    let content;
    try {
      content = readFileSync(join(root, relPath), 'utf8');
    } catch {
      if (missingFindingFor) findings.push(missingFindingFor(relPath));
      continue;
    }
    findings.push(...scanFn(content, relPath));
  }
  return findings;
}

function main() {
  const localeCount = getActualLocaleCount();
  const keyCount = getActualKeyCount();
  const latestVersion = getLatestReleasedVersion();
  const canonicalUrl = getCanonicalProductionUrl();
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  let bundleBudget;
  try {
    bundleBudget = readBundleBudget();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const taggedVersions = getTaggedVersions();
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const isFeatureBranchContext =
    process.env.GITHUB_EVENT_NAME === 'pull_request' || isOnFeatureBranch();
  const allFindings = [];
  allFindings.push(
    ...scanReleaseTruth(changelog, packageVersion, taggedVersions),
    ...scanUnreleasedTruth(
      changelog,
      getPostReleaseCommitSubjects(),
      packageVersion,
      taggedVersions,
      isFeatureBranchContext,
      isFeatureBranchContext ? getBranchLocalCommitCount() : 0,
    ),
  );
  allFindings.push(
    ...scanReadmeReleaseTruth(readFileSync(join(root, 'README.md'), 'utf8'), taggedVersions),
  );
  allFindings.push(...scanReadmeTestMetrics(readFileSync(join(root, 'README.md'), 'utf8')));

  // QNBS-v3 (codex): these two files are this gate's required subjects — silently skipping a missing/unreadable one would make the live-status enforcement disappear exactly when its input is unavailable, the same failure mode as the bundle-budget docs below.
  allFindings.push(
    ...scanRequiredFiles(TARGET_FILES, (content, relPath) =>
      scanForDrift(content, relPath, { localeCount, keyCount, latestVersion }),
    ),
    ...scanRequiredFiles(URL_CHECK_FILES, (content, relPath) =>
      scanForUrlDrift(content, relPath, canonicalUrl),
    ),
    ...scanRequiredFiles(
      SECURITY_STATUS_DOCS,
      scanSecurityDocPrStatus,
      (relPath) => `${relPath} — required security-status document is missing or unreadable`,
    ),
    ...scanRequiredFiles(
      BUNDLE_BUDGET_DOCS,
      (content, relPath) => scanBundleBudgetTruth(content, relPath, bundleBudget),
      (relPath) => `${relPath} — required current bundle-budget document is missing`,
    ),
    // QNBS-v3: current locale help is shipped to users, so every active locale must carry the same budget truth.
    ...scanRequiredFiles(
      getLocales().map((locale) => `locales/${locale}/help.json`),
      (content, relPath) => scanLocalizedBundleBudgetTruth(content, relPath, bundleBudget),
      (relPath) => `${relPath} — required current in-app help document is missing`,
    ),
  );

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
