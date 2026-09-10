#!/usr/bin/env node
/**
 * CI-only pre-merge admission gate: before a governed (feat|fix|perf) PR can merge, its own
 * CHANGELOG.md [Unreleased] section must already reference this PR's real GitHub-assigned number
 * as "PR #<N>". This closes the blind spot where scripts/check-doc-metrics.mjs's completeness
 * check only fires AFTER squash-merge, once the commit is on main and its subject already carries
 * "(#N)" — a gap that has recurred three times (#678->#679, #684->#685, #699->#700), each requiring
 * a same-pattern follow-up PR to add the missing reference after the fact.
 *
 * Deliberately self-contained (no local imports, mirrors check-commit-attribution.mjs) so the
 * base-ref self-grading copy in .github/workflows/pr-changelog-reference.yml never breaks on a
 * missing transitive dependency (check-doc-metrics.mjs itself imports two further local modules
 * that would also need copying and keeping in sync).
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// QNBS-v3: duplicated from check-doc-metrics.mjs's GOVERNED_COMMIT_TYPE (kept in sync manually, not via import) so this file has zero local dependencies — see file header.
const GOVERNED_COMMIT_TYPE = /^(?:feat|fix|perf)(?:\([^)]*\))?!?:\s*/i;

// QNBS-v3: strips comments from the WHOLE document before searching for the heading — a commented-out template containing a literal "## [Unreleased]" line earlier in the file would otherwise hijack the section boundary, since slicing off the opening "<!--" before comment-removal runs left the fake section's own content unstrippable.
function getUnreleasedSectionText(changelog) {
  const withoutComments = changelog.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const heading = /^## \[Unreleased\]\s*$/m.exec(withoutComments);
  if (!heading) return '';
  const afterHeading = withoutComments.slice(heading.index + heading[0].length);
  const nextHeading = afterHeading.search(/^##\s/m);
  return nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
}

// QNBS-v3: duplicated from check-doc-metrics.mjs's splitUnreleasedEntries for the same self-containment reason — joins a bullet's own soft-wrapped continuation lines into one entry.
function extractBulletEntries(unreleasedSection) {
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
    } else if (/^#{1,6}\s/.test(line)) {
      flush();
    } else if (current.length > 0 && line !== '') {
      current.push(line);
    } else if (line === '') {
      flush();
    }
  }
  flush();
  return entries;
}

// QNBS-v3: exact "PR #NNN" grammar with a full trailing word boundary (rejects "PR #705alpha"/"PR #705_"), stricter than check-doc-metrics.mjs's post-merge bare "#NNN" matcher since pre-merge there is no squash-appended "(#NNN)" to anchor on.
export function isReferencedByPrLabel(prNumber, text) {
  return new RegExp(`\\bPR\\s*#${prNumber}(?!\\w)`, 'i').test(text);
}

/** Pure decision function — kept separate from I/O so it is directly unit-testable. */
export function checkPrChangelogReference({ prNumber, prTitle, changelog }) {
  if (!GOVERNED_COMMIT_TYPE.test(prTitle ?? '')) {
    return { ok: true, reason: 'not-governed' };
  }
  // QNBS-v3: scoped to actual bullet entries, not the whole section — a PR number floating in prose or a sub-heading (not inside a real release-note bullet) must not count as documentation.
  const unreleasedSection = getUnreleasedSectionText(changelog ?? '');
  const bulletEntries = extractBulletEntries(unreleasedSection);
  return bulletEntries.some((entry) => isReferencedByPrLabel(prNumber, entry))
    ? { ok: true, reason: 'referenced' }
    : { ok: false, reason: 'missing-reference' };
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.log('[check-pr-changelog-reference] no GITHUB_EVENT_PATH — skipping');
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (error) {
    console.error(
      `[check-pr-changelog-reference] cannot read event payload: ${error instanceof Error ? error.message : 'invalid JSON'}`,
    );
    process.exit(1);
  }

  const pr = payload.pull_request;
  if (!pr) {
    console.log('[check-pr-changelog-reference] not a pull_request event — skipping');
    process.exit(0);
  }
  if (typeof pr.number !== 'number') {
    console.error(
      '[check-pr-changelog-reference] pull_request event payload is missing a numeric "number" field',
    );
    process.exit(1);
  }

  let changelog;
  try {
    changelog = readFileSync('CHANGELOG.md', 'utf8');
  } catch (error) {
    console.error(
      `[check-pr-changelog-reference] cannot read CHANGELOG.md: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  const result = checkPrChangelogReference({ prNumber: pr.number, prTitle: pr.title, changelog });
  if (result.reason === 'not-governed') {
    console.log(
      '[check-pr-changelog-reference] PR title is not a governed feat/fix/perf change — skipping',
    );
    process.exit(0);
  }
  if (!result.ok) {
    console.error(
      `[check-pr-changelog-reference] FAIL — CHANGELOG.md's [Unreleased] section does not yet reference "PR #${pr.number}". Add (or update) a bullet describing this change and reference it literally as "PR #${pr.number}" before merging.`,
    );
    process.exit(1);
  }
  console.log(`[check-pr-changelog-reference] OK — [Unreleased] references PR #${pr.number}`);
}

// QNBS-v3: only run the CLI side-effect when invoked directly — checkPrChangelogReference stays importable from a unit test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
