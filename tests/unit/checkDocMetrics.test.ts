// @vitest-environment node
/**
 * Tests for scripts/check-doc-metrics.mjs
 * QNBS-v3: protects the drift gate from historical-section regressions — an untested exclusion heuristic would turn it into noise.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getCanonicalProductionUrl,
  getTaggedVersions,
  scanBundleBudgetTruth,
  scanForDrift,
  scanForUrlDrift,
  scanLocalizedBundleBudgetTruth,
  scanReadmeTestMetrics,
  scanReleaseTruth,
  scanSecurityDocPrStatus,
  stripHistoricalSections,
  VERCEL_URL_PATTERN,
} from '../../scripts/check-doc-metrics.mjs';

const getTaggedVersionsAt = getTaggedVersions as unknown as (repositoryRoot: string) => Set<string>;
// QNBS-v3: keep executable-script exports typed locally while tsgo resolves the declaration file.
type ReleaseTruthModule = {
  scanReadmeReleaseTruth: (readme: string, taggedVersions: Set<string>) => string[];
  scanUnreleasedTruth: (
    changelog: string,
    subjects: string[] | null,
    packageVersion?: string,
    taggedVersions?: Set<string>,
    isFeatureBranchContext?: boolean,
    branchLocalIndices?: Set<number>,
  ) => string[];
  isOnFeatureBranch: (repositoryRoot?: string) => boolean;
  getBranchLocalSubjectIndices: (repositoryRoot?: string) => Set<number>;
  getPostReleaseCommitSubjects: (repositoryRoot?: string) => string[] | null;
};
// QNBS-v3: load the runtime-only scanners without making tsgo infer untyped .mjs exports.
const loadReleaseTruthModule = async () =>
  (await import('../../scripts/check-doc-metrics.mjs')) as unknown as ReleaseTruthModule;

// QNBS-v3: release truth must remain correct in normal repositories and linked worktrees.
describe('scanReleaseTruth', () => {
  it('rejects a dated changelog release without a matching tag', () => {
    expect(scanReleaseTruth('## [1.28.0] — 2026-08-21\n', '1.28.0', new Set(['1.27.1']))).toEqual([
      expect.stringContaining('no matching git tag v1.28.0'),
      expect.stringContaining('no [Unreleased] section exists'),
    ]);
  });

  it('accepts a newer package version only when it remains under Unreleased', () => {
    expect(scanReleaseTruth('## [Unreleased]\n', '1.28.0', new Set(['1.27.1']))).toEqual([]);
    expect(scanReleaseTruth('## [1.28.0] — 2026-08-21\n', '1.28.0', new Set(['1.28.0']))).toEqual(
      [],
    );
  });

  // QNBS-v3: verify pre-tag release documentation without weakening tagged-release validation.
  it('allows an explicitly marked release candidate before the merge-time tag is created', () => {
    expect(
      scanReleaseTruth(
        '## [Unreleased]\n\n<!-- release-candidate: v1.28.0 -->\n## [1.28.0] — 2026-08-21\n',
        '1.28.0',
        new Set(['1.27.1']),
      ),
    ).toEqual([]);
  });

  it('accepts a package version equal to the latest release tag', () => {
    expect(scanReleaseTruth('## [1.27.1] — 2026-08-14\n', '1.27.1', new Set(['1.27.1']))).toEqual(
      [],
    );
  });

  it('rejects a package version older than the latest release tag', () => {
    expect(scanReleaseTruth('## [Unreleased]\n', '1.27.0', new Set(['1.27.1']))).toEqual([
      expect.stringContaining('older than the latest git tag v1.27.1'),
    ]);
  });

  it('accepts valid historical headings below the current release frontier', () => {
    expect(scanReleaseTruth('## [1.20.0] — 2026-06-07\n', '1.27.1', new Set(['1.27.1']))).toEqual(
      [],
    );
  });

  it('skips dated-release tag checks in a tagless checkout', () => {
    expect(
      scanReleaseTruth('## [1.20.0] — 2025-01-01\n## [1.28.0] — 2026-08-21\n', '1.28.0', new Set()),
    ).toEqual([]);
  });
});

describe('README release truth', () => {
  // QNBS-v3: exercise the release badge invariant independently from changelog and package checks.
  it('rejects a released-version badge without a matching tag', async () => {
    const { scanReadmeReleaseTruth } = await loadReleaseTruthModule();
    expect(scanReadmeReleaseTruth('![Release v1.28.0](badge.svg)', new Set(['1.27.1']))).toEqual([
      expect.stringContaining('release badge advertises v1.28.0'),
    ]);
  });

  // QNBS-v3: preserve the explicit development-label exception for prerelease badges.
  it('allows an explicitly unreleased development badge', async () => {
    const { scanReadmeReleaseTruth } = await loadReleaseTruthModule();
    expect(
      scanReadmeReleaseTruth(
        '<img alt="Next v1.28.0 (unreleased)" src="Next-v1.28.0-blue">',
        new Set(['1.27.1']),
      ),
    ).toEqual([]);
  });

  // QNBS-v3: verify README release badges during the merge-time candidate window.
  it('allows a release badge with the matching release-candidate marker before tagging', async () => {
    const { scanReadmeReleaseTruth } = await loadReleaseTruthModule();
    expect(
      scanReadmeReleaseTruth(
        '<!-- release-candidate: v1.28.0 -->\n![Release v1.28.0](release.svg)',
        new Set(['1.27.1']),
      ),
    ).toEqual([]);
  });

  // QNBS-v3: inspect every badge in one row so a valid Next badge cannot mask an invalid Release badge.
  it('checks a later released badge after a development badge', async () => {
    const { scanReadmeReleaseTruth } = await loadReleaseTruthModule();
    expect(
      scanReadmeReleaseTruth(
        '![Next v1.28.0 (unreleased)](next.svg) ![Release v1.29.0](release.svg)',
        new Set(['1.27.1']),
      ),
    ).toEqual([expect.stringContaining('release badge advertises v1.29.0')]);
  });
});

describe('README test metrics truth', () => {
  // QNBS-v3: ensure every README test-count presentation stays synchronized with the shared Vitest source set.
  it('accepts the current deterministic Vitest source metrics', () => {
    expect(
      scanReadmeTestMetrics(readFileSync(new URL('../../README.md', import.meta.url), 'utf8')),
    ).toEqual([]);
  });

  // QNBS-v3: stale badges must fail docs:check instead of preserving an old count during local sync.
  it('rejects stale test counts instead of silently preserving them', () => {
    expect(scanReadmeTestMetrics('![Tests-1%2B_%2F_1_files](badge.svg)')).not.toEqual([]);
  });
});

// QNBS-v3: Lock documentation budgets to the executable source so stale gate claims fail closed.
describe('bundle budget truth', () => {
  const budget = { entryKb: 2500, vendorKb: 6200, chunkKb: 2500, wasmKb: 30000 };
  const statement = [
    '<!-- bundle-budget:source-of-truth -->',
    'Raw bundle-budget ceilings (KB per uncompressed asset): entry **2500 KB**, vendor **6200 KB**, other JavaScript **2500 KB**, and WASM **30000 KB**.',
  ].join('\n');

  it('accepts a current source-of-truth statement', () => {
    expect(scanBundleBudgetTruth(statement, 'FAKE.md', budget)).toEqual([]);
  });

  it('accepts the current statement with CRLF line endings', () => {
    expect(scanBundleBudgetTruth(statement.replaceAll('\n', '\r\n'), 'FAKE.md', budget)).toEqual(
      [],
    );
  });

  it('rejects stale budget documentation', () => {
    expect(
      scanBundleBudgetTruth(statement.replace('2500 KB', '4500 KB'), 'FAKE.md', budget),
    ).toEqual([expect.stringContaining('does not match config/bundle-budget.json')]);
  });

  // QNBS-v3: Localized help truth prevents user-facing budget drift across all 19 locales.
  it('checks the localized in-app help claim independently of formatting', () => {
    const localeFiles = readdirSync(join(process.cwd(), 'locales'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(process.cwd(), 'locales', entry.name, 'help.json'))
      .filter((filePath) => {
        try {
          readFileSync(filePath, 'utf8');
          return true;
        } catch {
          return false;
        }
      });
    expect(localeFiles).toHaveLength(19);
    for (const filePath of localeFiles) {
      expect(
        scanLocalizedBundleBudgetTruth(readFileSync(filePath, 'utf8'), filePath, budget),
      ).toEqual([]);
    }

    const localizedClaim = JSON.stringify({
      'help.docs.lazyLoading.content': '<li>Vendor: 6 200 KB; Entry: 2 500 KB.</li>',
    });
    const staleClaim = localizedClaim.replace('6 200', '7 000').replace('2 500', '4 500');
    const staleAndCurrentClaim = JSON.stringify({
      'help.docs.lazyLoading.content':
        '<li>Vendor: 7 000 KB; Entry: 2 500 KB; legacy entry: 4 500 KB.</li>',
    });
    const swappedClaim = JSON.stringify({
      'help.docs.lazyLoading.content': '<li>Vendor: 2 500 KB; Entry: 6 200 KB.</li>',
    });
    const unrelatedNumbersBeforeClaim = JSON.stringify({
      'help.docs.lazyLoading.content':
        '<li>14 views and ~200 KB gzip.</li><li>Vendor: 6 200 KB; Entry: 2 500 KB.</li>',
    });
    expect(scanLocalizedBundleBudgetTruth(localizedClaim, 'locales/en/help.json', budget)).toEqual(
      [],
    );
    expect(scanLocalizedBundleBudgetTruth(staleClaim, 'locales/en/help.json', budget)).toEqual([
      expect.stringContaining('does not match config/bundle-budget.json'),
    ]);
    expect(
      scanLocalizedBundleBudgetTruth(staleAndCurrentClaim, 'locales/en/help.json', budget),
    ).toEqual([expect.stringContaining('does not match config/bundle-budget.json')]);
    expect(scanLocalizedBundleBudgetTruth(swappedClaim, 'locales/en/help.json', budget)).toEqual([
      expect.stringContaining('does not match config/bundle-budget.json'),
    ]);
    expect(
      scanLocalizedBundleBudgetTruth(unrelatedNumbersBeforeClaim, 'locales/en/help.json', budget),
    ).toEqual([]);
  });
});

describe('Unreleased truth', () => {
  // QNBS-v3: require real changelog history after a release instead of accepting comment-only placeholders.
  it('rejects post-release commits when Unreleased has no meaningful content', async () => {
    const { scanUnreleasedTruth } = await loadReleaseTruthModule();
    expect(scanUnreleasedTruth('## [Unreleased]\n\n### Added\n', ['feat: new feature'])).toEqual([
      expect.stringContaining('[Unreleased] is empty'),
    ]);
  });

  // QNBS-v3: keep a populated Unreleased section valid for development versions.
  it('accepts populated Unreleased content after the latest release', async () => {
    const { scanUnreleasedTruth } = await loadReleaseTruthModule();
    expect(
      scanUnreleasedTruth('## [Unreleased]\n\n### Added\n\n- New feature\n', ['feat: new feature']),
    ).toEqual([]);
  });

  // QNBS-v3: verify the candidate marker permits empty Unreleased only during pre-tag release preparation.
  it('accepts an empty Unreleased section while an explicitly marked release candidate is pending its tag', async () => {
    const { scanUnreleasedTruth } = await loadReleaseTruthModule();
    expect(
      scanUnreleasedTruth(
        '## [Unreleased]\n\n<!-- release-candidate: v1.28.0 -->\n\n## [1.28.0] — 2026-08-21\n',
        ['fix: release candidate'],
        '1.28.0',
        new Set(['1.27.1']),
      ),
    ).toEqual([]);
  });

  // QNBS-v3: ensure tagging the candidate immediately restores the normal Unreleased-history requirement.
  it('rejects an empty Unreleased section after the candidate is tagged', async () => {
    const { scanUnreleasedTruth } = await loadReleaseTruthModule();
    expect(
      scanUnreleasedTruth(
        '## [Unreleased]\n\n<!-- release-candidate: v1.28.0 -->\n\n## [1.28.0] — 2026-08-21\n',
        ['fix: post-release correction'],
        '1.28.0',
        new Set(['1.27.1', '1.28.0']),
      ),
    ).toEqual([expect.stringContaining('[Unreleased] is empty')]);
  });

  // QNBS-v3: prevent a stale or unrelated candidate marker from suppressing post-release drift.
  it('rejects an empty Unreleased section for a different candidate marker', async () => {
    const { scanUnreleasedTruth } = await loadReleaseTruthModule();
    expect(
      scanUnreleasedTruth(
        '## [Unreleased]\n\n<!-- release-candidate: v1.27.0 -->\n\n## [1.27.0] — 2026-08-14\n',
        ['fix: post-release correction'],
        '1.28.0',
        new Set(['1.27.1']),
      ),
    ).toEqual([expect.stringContaining('[Unreleased] is empty')]);
  });

  // QNBS-v3: treat multiline HTML comments as non-content in the release-history check.
  it('rejects multiline-comment-only Unreleased content', async () => {
    const { scanUnreleasedTruth } = await loadReleaseTruthModule();
    expect(
      scanUnreleasedTruth('## [Unreleased]\n\n<!--\nplaceholder\ncomment\n-->\n', [
        'fix: post-release correction',
      ]),
    ).toEqual([expect.stringContaining('[Unreleased] is empty')]);
  });

  // QNBS-v3 (audit F-2): the actual bug this section exists to catch — a single unrelated doc-sync
  // bullet previously satisfied "meaningful content" forever, so a real feat/fix commit could go
  // completely undocumented while docs:check stayed green. Completeness must be checked per commit.
  describe('completeness — every governed commit must be individually referenced', () => {
    const populatedButUnrelated = '## [Unreleased]\n\n### Documentation\n\n- Unrelated doc sync.\n';

    it('rejects a governed commit referenced by neither PR number nor subject slug', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(populatedButUnrelated, [
        'fix(project): retain raw header verdict on projection failure',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('does not reference 1 post-tag feat/fix/perf commit');
      expect(findings[0]).toContain('retain raw header verdict');
    });

    it('accepts a governed commit referenced by its trailing PR number', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Something about migration-gap copy. PR #656.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(i18n): distinguish migration-gap startup copy (#656)',
      ]);
      expect(findings).toEqual([]);
    });

    it('extracts the TRAILING PR number, not a mid-subject issue reference', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      // QNBS-v3: real house style embeds an issue ref mid-subject ("(#553)") before the actual
      // trailing squash-merge PR number ("(#621)") — referencing only the issue number must NOT
      // satisfy the check for the PR.
      const changelog = '## [Unreleased]\n\n### Fixed\n\n- Closes #553 eventually.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): enforce raw schemaVersion integer grammar (#553) (#621)',
      ]);
      expect(findings).toHaveLength(1);
    });

    it('accepts a governed commit with no PR number, referenced by subject slug', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Canonical document projection now reuses parsed input.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): reuse parsed canonical document input',
      ]);
      expect(findings).toEqual([]);
    });

    it('does not require build/chore/docs commits to be individually referenced', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(populatedButUnrelated, [
        'build(deps): bump some-package from 1.0.0 to 1.0.1 (#700)',
        'chore(agent): unrelated housekeeping',
        'docs: unrelated doc update',
      ]);
      expect(findings).toEqual([]);
    });

    it('lists every undocumented governed commit, not just the first', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(populatedButUnrelated, [
        'feat(project): establish canonical document projection foundation',
        'fix(project): reuse parsed canonical document input',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('does not reference 2 post-tag feat/fix/perf commit');
    });

    // QNBS-v3 (coderabbit/CodeAnt): "#65" is a substring of "#656" — a naive String.includes
    // check let a shorter/longer PR number incorrectly satisfy a completely different one.
    it('does not let a shorter PR number satisfy a longer one that contains it as a substring', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog = '## [Unreleased]\n\n### Fixed\n\n- Something unrelated. PR #6567.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(i18n): distinguish migration-gap startup copy (#656)',
      ]);
      expect(findings).toHaveLength(1);
    });

    it('does not let a longer PR number satisfy a shorter one it contains as a substring', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog = '## [Unreleased]\n\n### Fixed\n\n- Something unrelated. PR #65.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(i18n): distinguish migration-gap startup copy (#656)',
      ]);
      expect(findings).toHaveLength(1);
    });

    // QNBS-v3 (codex): matching must be scoped to ONE changelog entry — words scattered across
    // several unrelated bullets must not collectively satisfy a commit none of them documents,
    // and one bullet's generic words must not simultaneously "document" multiple commits.
    it('does not let slug words scattered across separate unrelated bullets satisfy a commit', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog = [
        '## [Unreleased]',
        '',
        '### Fixed',
        '',
        '- Something about canonical naming conventions.',
        '- A separate change involving document upload limits.',
        '- Another unrelated projection-mapping utility update.',
      ].join('\n');
      const findings = scanUnreleasedTruth(changelog, [
        'feat(project): establish canonical document projection foundation',
      ]);
      expect(findings).toHaveLength(1);
    });

    it('does not let one generic bullet satisfy multiple different undocumented commits', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog = '## [Unreleased]\n\n### Fixed\n\n- A change involving canonical data.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'feat(project): establish canonical document projection foundation',
        'fix(project): reuse parsed canonical document input',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('does not reference 2 post-tag feat/fix/perf commit');
    });

    // QNBS-v3 (codex): the previous test's bullet is too generic for EITHER commit to individually
    // clear the 60% threshold — this one is specific enough that BOTH would clear it alone,
    // proving the fix is genuine "claim, don't reuse" exclusivity, not incidental low overlap.
    it('claims a matched entry exclusively — a second commit cannot reuse it even above threshold', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Canonical document projection foundation established.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'feat(project): establish canonical document projection foundation',
        'fix(project): reuse canonical document projection foundation',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('does not reference 1 post-tag feat/fix/perf commit');
      expect(findings[0]).toContain('reuse canonical document projection foundation');
    });

    // QNBS-v3 (codex): greedily claiming the FIRST matching entry is order-dependent — a fully
    // documented changelog could be wrongly rejected depending only on which commit is checked
    // first. Here the broader commit (6 words) can match EITHER entry, but the narrower commit
    // (4 words) can only match the first entry; a correct maximum-matching assignment documents
    // both regardless of processing order (the broader one takes the second entry, freeing the
    // first for the narrower one).
    it('finds a valid assignment even when a broader commit could greedily claim the only entry a narrower commit needs', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog = [
        '## [Unreleased]',
        '',
        '### Fixed',
        '',
        '- Alpha beta gamma delta.',
        '- Alpha beta epsilon zeta.',
      ].join('\n');
      const findingsForward = scanUnreleasedTruth(changelog, [
        'fix(project): alpha beta gamma delta epsilon zeta',
        'fix(project): alpha beta gamma delta',
      ]);
      expect(findingsForward).toEqual([]);

      // QNBS-v3: same commits, reversed order — must still fully document both.
      const findingsReversed = scanUnreleasedTruth(changelog, [
        'fix(project): alpha beta gamma delta',
        'fix(project): alpha beta gamma delta epsilon zeta',
      ]);
      expect(findingsReversed).toEqual([]);
    });

    // QNBS-v3 (codex): a negated commit description must never slug-match an entry describing the opposite, unnegated action — ratio-based word overlap alone can't tell "do not delete X" from "Delete X".
    it('does not let a negated commit description slug-match an entry with the opposite polarity', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Delete malformed project data during import.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): do not delete malformed project data',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('do not delete malformed project data');
    });

    // QNBS-v3: a genuinely negated entry documenting the negated behavior must still match normally.
    it('still slug-matches when both the commit and the entry share the same negated polarity', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Do not delete malformed project data during import.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): do not delete malformed project data',
      ]);
      expect(findings).toEqual([]);
    });

    // QNBS-v3 (codex): a negation word in an entry's rationale prose AFTER its **bold** lead claim must not disqualify the match — this repo's own CHANGELOG.md has real entries where the bold lead states the change and trailing prose incidentally uses a word like "cannot" to describe unrelated circumstances.
    it("does not let a negation word in an entry's rationale prose outside its bold lead disqualify the match", async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- **Unsupported-project startup copy added** so a build that cannot open the project shows its own message.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(i18n): add unsupported-project startup copy',
      ]);
      expect(findings).toEqual([]);
    });

    // QNBS-v3 (codex): negation inside the bold lead itself must still be detected — the scoping must narrow the check, not silently disable it.
    it('still detects negation inside the bold lead itself', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- **Do not delete malformed project data** during import.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): do not delete malformed project data',
      ]);
      expect(findings).toEqual([]);
    });

    // QNBS-v3 (codex): a typographic apostrophe ("don't") must be recognized as negation too, or the tokenizer turns it into the unmatched word "don" and the remaining words alone can clear the ratio against the opposite-polarity entry.
    it('recognizes a typographic apostrophe as negation', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Delete malformed project data during import.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): don’t delete malformed project data',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('delete malformed project data');
    });

    // QNBS-v3 (codex): "avoid"/"prevent" express negative polarity without any literal not/never — a preserve-first commit worded this way must not slug-match an entry describing the opposite, unguarded action.
    it('treats avoidance verbs like "prevent" as negative polarity', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Delete malformed project data during import.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): prevent deleting malformed project data',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('prevent deleting malformed project data');
    });

    // QNBS-v3 (codex): "refuse"/"stop"/"disable" are further negative-polarity refusal verbs beyond avoid/prevent.
    it('treats refusal verbs like "refuse" as negative polarity', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Delete malformed project data during import.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): refuse to delete malformed project data',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('refuse to delete malformed project data');
    });

    // QNBS-v3 (codex): a short alphanumeric token (a version, a limit) can be the only significant word distinguishing a short subject — the length filter must not silently drop it from the comparison.
    it('preserves a short numeric token that is the only other significant word', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog = '## [Unreleased]\n\n### Fixed\n\n- Retry 20.\n';
      const findings = scanUnreleasedTruth(changelog, ['fix(project): retry 10']);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('retry 10');
    });

    // QNBS-v3 (codex): truncating a long subject's significant words to the first six could drop trailing words entirely, letting a truncated 66%-overlap ratio wrongly clear the 60% threshold when the full word list would correctly fall below it.
    it('does not drop trailing significant words that would prevent a false slug match', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Alpha beta gamma delta refactor summary.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): alpha beta gamma delta epsilon zeta eta',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('alpha beta gamma delta epsilon zeta eta');
    });

    // QNBS-v3 (codex): a numbered commit has an unambiguous way to be referenced — it must not
    // fall back to a fuzzy slug match against a different, older bullet that merely shares words.
    it('requires the exact PR number for a numbered commit, never a slug fallback', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Canonical document projection now reuses parsed input.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): reuse parsed canonical document input (#999)',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('#999');
    });

    // QNBS-v3 (codex): a PR number mentioned only in surrounding prose, never inside an actual release-note bullet, must not count as documentation.
    it('does not treat a PR number mentioned in non-bullet prose as documentation', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\nFor context see #999.\n\n- Unrelated doc sync.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): resolve unrelated regression (#999)',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('#999');
    });

    // QNBS-v3 (codex): a hex-color-like token such as "#999abc" must not satisfy an exact reference to PR #999 — the boundary must reject a letter continuation, not just a digit.
    it('does not treat a hex-color-like token as a reference to a PR number', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Update accent color token to #999abc for contrast.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): resolve unrelated regression (#999)',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('#999');
    });

    // QNBS-v3 (codex): a numbered commit's exact-PR-number match must reserve its entry, otherwise an unrelated un-numbered commit's slug match can silently reuse the same bullet.
    it("does not let a numbered commit's entry double as an unrelated commit's slug match", async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Canonical document projection foundation. PR #999.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): canonical document projection foundation (#999)',
        'fix(project): reuse canonical document projection foundation',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('reuse canonical document projection foundation');
    });

    // QNBS-v3 (codex): the same PR number split across two separate bullets must reserve BOTH, not just the first findIndex() hit — otherwise an unrelated commit's slug match can claim the un-reserved second bullet.
    it('reserves every entry referencing the same numbered commit, not just the first', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Canonical document projection foundation. PR #999.\n- Canonical document projection foundation restated. PR #999.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): canonical document projection foundation (#999)',
        'fix(project): reuse canonical document projection foundation',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('reuse canonical document projection foundation');
    });

    // QNBS-v3 (codex): an entry listing several PR numbers still reserves for each, so it must keep refusing an unrelated commit's slug match.
    it('reserves an entry that lists multiple PR numbers, still blocking an unrelated slug match', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Canonical document projection foundation. PR #999, PR #998.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): canonical document projection foundation (#999)',
        'fix(project): reuse canonical document projection foundation',
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('reuse canonical document projection foundation');
    });

    // QNBS-v3 (codex): reservation must never make the second numbered commit sharing that entry itself undocumented.
    it('lets two numbered commits share one entry that lists both their PR numbers', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const changelog =
        '## [Unreleased]\n\n### Fixed\n\n- Canonical document projection foundation. PR #999, PR #998.\n';
      const findings = scanUnreleasedTruth(changelog, [
        'fix(project): canonical document projection foundation (#999)',
        'fix(project): canonical document projection refinement (#998)',
      ]);
      expect(findings).toEqual([]);
    });

    // QNBS-v3 (codex, P1): a pull_request CI run's git-log range enumerates every commit unique
    // to that branch, not the one commit that will exist after squash-merge — a routine
    // review-fix follow-up commit (necessarily un-numbered, since it hasn't been squash-merged
    // yet) can't reference itself in [Unreleased] in advance. Only UN-numbered commits are
    // exempted in pull_request context; full completeness is otherwise enforced everywhere
    // (locally, on push to main right after merge, and for any already-numbered commit even
    // during a pull_request run — see the next test).
    it('does not enforce completeness for an un-numbered commit in pull_request CI context', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(
        populatedButUnrelated,
        ['fix(project): retain raw header verdict on projection failure'],
        undefined,
        undefined,
        true,
        new Set([0]),
      );
      expect(findings).toEqual([]);
    });

    // QNBS-v3 (codex): the un-numbered exemption must key off the computed branch-local set, not the overall pull_request context alone — an unnumbered commit that is NOT branch-local (already reachable from main) must still go through the normal slug check.
    it('does not exempt an unnumbered commit that is not actually branch-local, even in pull_request CI context', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(
        populatedButUnrelated,
        [
          'fix(project): retain raw header verdict on projection failure',
          'fix(project): apply an unrelated branch-local adjustment',
        ],
        undefined,
        undefined,
        true,
        new Set([1]),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('retain raw header verdict on projection failure');
    });

    // QNBS-v3 (codex, P1): exempting a PR's own in-flight commits must not weaken enforcement for
    // an already-numbered commit sitting in the same range (e.g. from a separate, already-merged
    // PR) — that one is real, permanent history and must still be caught even during a
    // pull_request run.
    it('still enforces completeness for an already-numbered commit in pull_request CI context', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(
        populatedButUnrelated,
        ['fix(project): retain raw header verdict on projection failure (#999)'],
        undefined,
        undefined,
        true,
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('#999');
    });

    // QNBS-v3 (codex): this repository's own history shows the eventual squashed form "... (#553) (#621)", so a branch-local "(#553)" must not be treated as an already-merged PR number.
    it('exempts a branch-local commit whose trailing token is an in-flight issue reference, not a PR number', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(
        populatedButUnrelated,
        ['fix(project): enforce raw schemaVersion integer grammar (#553)'],
        undefined,
        undefined,
        true,
        new Set([0]),
      );
      expect(findings).toEqual([]);
    });

    // QNBS-v3 (codex): the branch-local exemption must only cover commits above the main branch point, never an older, already-merged numbered commit sitting lower in the same range.
    it('still enforces an already-merged numbered commit below the branch-local window', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(
        populatedButUnrelated,
        [
          'fix(project): enforce raw schemaVersion integer grammar (#553)',
          'fix(project): retain raw header verdict on projection failure (#999)',
        ],
        undefined,
        undefined,
        true,
        new Set([0]),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('#999');
      expect(findings[0]).not.toContain('#553');
    });

    it('still rejects a completely empty [Unreleased] in pull_request CI context', async () => {
      const { scanUnreleasedTruth } = await loadReleaseTruthModule();
      const findings = scanUnreleasedTruth(
        '## [Unreleased]\n\n### Added\n',
        ['fix(project): retain raw header verdict on projection failure'],
        undefined,
        undefined,
        true,
      );
      expect(findings).toEqual([expect.stringContaining('[Unreleased] is empty')]);
    });
  });
});

describe('isOnFeatureBranch', () => {
  function initTempRepo(prefix: string): string {
    const repositoryRoot = mkdtempSync(join(process.cwd(), prefix));
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repositoryRoot]);
    execFileSync('git', ['-C', repositoryRoot, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', repositoryRoot, 'config', 'user.name', 'Test']);
    writeFileSync(join(repositoryRoot, 'file.txt'), 'content');
    execFileSync('git', ['-C', repositoryRoot, 'add', 'file.txt']);
    execFileSync('git', ['-C', repositoryRoot, 'commit', '--quiet', '-m', 'init']);
    return repositoryRoot;
  }

  it('returns false when HEAD is main', async () => {
    const { isOnFeatureBranch } = await loadReleaseTruthModule();
    const repositoryRoot = initTempRepo('.tmp-worldscript-doc-metrics-branch-main-');
    try {
      expect(isOnFeatureBranch(repositoryRoot)).toBe(false);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('returns true when HEAD is a feature branch', async () => {
    const { isOnFeatureBranch } = await loadReleaseTruthModule();
    const repositoryRoot = initTempRepo('.tmp-worldscript-doc-metrics-branch-feature-');
    try {
      execFileSync('git', ['-C', repositoryRoot, 'switch', '--quiet', '-c', 'fix/example']);
      expect(isOnFeatureBranch(repositoryRoot)).toBe(true);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  // QNBS-v3: actions/checkout leaves every GitHub Actions event, push included, in detached HEAD.
  it('returns false when HEAD is detached, matching a push-to-main CI checkout', async () => {
    const { isOnFeatureBranch } = await loadReleaseTruthModule();
    const repositoryRoot = initTempRepo('.tmp-worldscript-doc-metrics-branch-detached-');
    try {
      const headSha = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['-C', repositoryRoot, 'checkout', '--quiet', '--detach', headSha]);
      expect(isOnFeatureBranch(repositoryRoot)).toBe(false);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  // QNBS-v3: fails closed to "not a feature branch" (full strictness) on any git error, matching
  // this file's other git-plumbing helpers' fail-safe posture — never fails open into leniency.
  it('fails closed to false when not a git repository', async () => {
    const { isOnFeatureBranch } = await loadReleaseTruthModule();
    // QNBS-v3: git searches upward for a .git directory, so a plain subdirectory of THIS actual
    // repository would still resolve to ITS branch — use a location outside any git repository
    // (tmpdir(), not process.cwd()) so this genuinely exercises the no-repository failure path.
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'worldscript-doc-metrics-nogit-'));
    try {
      expect(isOnFeatureBranch(repositoryRoot)).toBe(false);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});

describe('getBranchLocalSubjectIndices', () => {
  function initTempRepo(prefix: string): string {
    const repositoryRoot = mkdtempSync(join(process.cwd(), prefix));
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repositoryRoot]);
    execFileSync('git', ['-C', repositoryRoot, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', repositoryRoot, 'config', 'user.name', 'Test']);
    writeFileSync(join(repositoryRoot, 'file.txt'), 'content');
    execFileSync('git', ['-C', repositoryRoot, 'add', 'file.txt']);
    execFileSync('git', ['-C', repositoryRoot, 'commit', '--quiet', '-m', 'init']);
    execFileSync('git', ['-C', repositoryRoot, 'tag', '-m', 'v1.0.0', 'v1.0.0']);
    return repositoryRoot;
  }

  function addCommit(repositoryRoot: string, message: string): void {
    writeFileSync(join(repositoryRoot, `${message}.txt`), message);
    execFileSync('git', ['-C', repositoryRoot, 'add', '-A']);
    execFileSync('git', ['-C', repositoryRoot, 'commit', '--quiet', '-m', message]);
  }

  it('returns an empty set on main itself', async () => {
    const { getBranchLocalSubjectIndices } = await loadReleaseTruthModule();
    const repositoryRoot = initTempRepo('.tmp-worldscript-doc-metrics-branchlocal-main-');
    try {
      expect(getBranchLocalSubjectIndices(repositoryRoot)).toEqual(new Set());
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  // QNBS-v3: mirrors this repository's own feat/553-universal-ingress-admission, several commits ahead of main with no open PR yet.
  it('identifies commits unique to a feature branch since it diverged from main', async () => {
    const { getPostReleaseCommitSubjects, getBranchLocalSubjectIndices } =
      await loadReleaseTruthModule();
    const repositoryRoot = initTempRepo('.tmp-worldscript-doc-metrics-branchlocal-feature-');
    try {
      execFileSync('git', ['-C', repositoryRoot, 'switch', '--quiet', '-c', 'fix/example']);
      addCommit(repositoryRoot, 'first');
      addCommit(repositoryRoot, 'second');
      const subjects = getPostReleaseCommitSubjects(repositoryRoot) ?? [];
      const branchLocalIndices = getBranchLocalSubjectIndices(repositoryRoot);
      expect(branchLocalIndices.size).toBe(2);
      expect([...branchLocalIndices].every((index) => subjects[index] !== undefined)).toBe(true);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  // QNBS-v3 (codex): git log's default order can interleave an already-merged main commit between branch-local ones once the branch has merged main in — the prior positional "newest N" window misclassified both sides here.
  it('classifies each commit by ancestry, not log position, once the branch has merged main in', async () => {
    const { getPostReleaseCommitSubjects, getBranchLocalSubjectIndices } =
      await loadReleaseTruthModule();
    const repositoryRoot = initTempRepo('.tmp-worldscript-doc-metrics-branchlocal-merge-');
    try {
      execFileSync('git', ['-C', repositoryRoot, 'switch', '--quiet', '-c', 'fix/example']);
      addCommit(repositoryRoot, 'branch1');
      execFileSync('git', ['-C', repositoryRoot, 'switch', '--quiet', 'main']);
      addCommit(repositoryRoot, 'main-new');
      execFileSync('git', ['-C', repositoryRoot, 'switch', '--quiet', 'fix/example']);
      execFileSync('git', [
        '-C',
        repositoryRoot,
        'merge',
        '--no-ff',
        '--quiet',
        '-m',
        'merge-main',
        'main',
      ]);
      addCommit(repositoryRoot, 'branch2');

      const subjects = getPostReleaseCommitSubjects(repositoryRoot) ?? [];
      const branchLocalIndices = getBranchLocalSubjectIndices(repositoryRoot);
      const mainNewIndex = subjects.indexOf('main-new');
      const branch1Index = subjects.indexOf('branch1');

      expect(mainNewIndex).toBeGreaterThanOrEqual(0);
      expect(branch1Index).toBeGreaterThanOrEqual(0);
      expect(branchLocalIndices.has(mainNewIndex)).toBe(false);
      expect(branchLocalIndices.has(branch1Index)).toBe(true);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('fails closed to an empty set when not a git repository', async () => {
    const { getBranchLocalSubjectIndices } = await loadReleaseTruthModule();
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), 'worldscript-doc-metrics-branchlocal-nogit-'),
    );
    try {
      expect(getBranchLocalSubjectIndices(repositoryRoot)).toEqual(new Set());
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});

describe('getTaggedVersions', () => {
  it('reads packed and loose tags from a standard repository', () => {
    const repositoryRoot = mkdtempSync(join(process.cwd(), '.tmp-worldscript-doc-metrics-'));
    try {
      mkdirSync(join(repositoryRoot, '.git', 'refs', 'tags'), { recursive: true });
      writeFileSync(
        join(repositoryRoot, '.git', 'packed-refs'),
        `# pack-refs with: peeled fully-peeled\n${'a'.repeat(40)} refs/tags/v1.27.1\n`,
      );
      writeFileSync(join(repositoryRoot, '.git', 'refs', 'tags', 'v1.28.0'), `${'b'.repeat(40)}\n`);

      expect(getTaggedVersionsAt(repositoryRoot)).toEqual(new Set(['1.27.1', '1.28.0']));
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('follows linked-worktree gitdir and commondir pointers', () => {
    const repositoryRoot = mkdtempSync(
      join(process.cwd(), '.tmp-worldscript-doc-metrics-worktree-'),
    );
    const worktreeRoot = join(repositoryRoot, 'worktree');
    const worktreeGitDir = join(repositoryRoot, 'main.git', 'worktrees', 'linked');
    const commonGitDir = join(repositoryRoot, 'main.git');
    try {
      mkdirSync(worktreeRoot, { recursive: true });
      mkdirSync(worktreeGitDir, { recursive: true });
      mkdirSync(join(commonGitDir, 'refs', 'tags'), { recursive: true });
      writeFileSync(join(worktreeRoot, '.git'), 'gitdir: ../main.git/worktrees/linked\n');
      writeFileSync(join(worktreeGitDir, 'commondir'), '../..\n');
      writeFileSync(join(commonGitDir, 'packed-refs'), `${'c'.repeat(40)} refs/tags/v1.27.1\n`);
      writeFileSync(join(commonGitDir, 'refs', 'tags', 'v1.28.0'), `${'d'.repeat(40)}\n`);

      expect(getTaggedVersionsAt(worktreeRoot)).toEqual(new Set(['1.27.1', '1.28.0']));
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});

describe('stripHistoricalSections', () => {
  it('blanks a Keep-a-Changelog-style `## [x.y.z]` section', () => {
    const md = [
      '## [1.24.0] — 2026-06-21',
      '',
      'Shipped with 17 locales.',
      '',
      '## Current state',
      '',
      'Ships 19 locales.',
    ].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).not.toContain('17 locales');
    expect(stripped).toContain('19 locales');
  });

  it('blanks a `## vX.Y.Z … RELEASED …` section', () => {
    const md = [
      '## v1.23.0 — Rebrand (RELEASED 2026-06-16)',
      '',
      'Shipped with 11 locales.',
      '',
      '## Upcoming',
      '',
      'Targeting 19 locales.',
    ].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).not.toContain('11 locales');
    expect(stripped).toContain('19 locales');
  });

  it('does NOT exclude a present-tense heading that merely mentions a version in prose', () => {
    const md = ['## Current status', '', 'As of v1.24.1, the app ships 17 locales.'].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).toContain('17 locales');
  });

  it('re-enables scanning once a non-historical heading follows a historical one', () => {
    const md = [
      '## [1.23.0]',
      'Historical: 11 locales.',
      '## Roadmap',
      'Present: 17 locales.',
      '## [1.24.0]',
      'Historical again: 11 locales.',
    ].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).not.toMatch(/Historical/);
    expect(stripped).toContain('Present: 17 locales.');
  });

  // QNBS-v3: regression guard for the dc14bc0-shaped drift — a stale open bullet was invisible to the gate inside a historical section
  it('preserves an open "⬜" bullet even inside a dated/historical section', () => {
    const md = [
      '## v1.24.2 — CSP/crypto/doc-truth hardening (2026-07-29)',
      '',
      '- ⬜ **Tag `v1.24.2` + publish the GitHub Release** — maintainer action.',
    ].join('\n');
    const stripped = stripHistoricalSections(md);
    expect(stripped).toContain('⬜ **Tag `v1.24.2`');
  });

  it('still blanks a "✅" bullet even inside a live, non-historical section', () => {
    const md = ['## Current status', '', '- ✅ Already-done item that should not be scanned.'].join(
      '\n',
    );
    const stripped = stripHistoricalSections(md);
    expect(stripped).not.toContain('Already-done item');
  });
});

describe('scanForDrift', () => {
  const actual = { localeCount: 19, keyCount: 2849, latestVersion: '1.24.1' };

  it('flags a present-tense locale-count mismatch', () => {
    const content = 'WorldScript Studio ships **17 locales**.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings.some((f) => f.includes('17 locale'))).toBe(true);
  });

  it('does not flag a matching locale count', () => {
    const content = 'WorldScript Studio ships **19 locales**.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings).toHaveLength(0);
  });

  it('does not flag a locale-count mismatch inside a historical section', () => {
    const content = ['## [1.23.0]', '', 'Shipped 11 locales.'].join('\n');
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings).toHaveLength(0);
  });

  it('flags a key-count mismatch', () => {
    const content = 'Shipped UI locales with **2844 i18n keys**.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings.some((f) => f.includes('2844'))).toBe(true);
  });

  it('flags a stale PLANNED marker for an already-released version', () => {
    const content = '## Upcoming — v1.24 (PLANNED)';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings.some((f) => f.includes('PLANNED'))).toBe(true);
  });

  it('does not flag a PLANNED marker for a version newer than the latest release', () => {
    const content = '## Upcoming — v2.0 (PLANNED)';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3: the OPEN_BULLET_VERSION check — a stale open tag/release bullet for an already-released version must be flagged
  it('flags an open "⬜" bullet for tagging/releasing a version <= the latest release', () => {
    const content = '- ⬜ **Tag `v1.24.1` + publish the GitHub Release** — maintainer action.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings.some((f) => f.includes('v1.24.1'))).toBe(true);
  });

  it.each(['Tagging', 'Releasing', 'Publishing'])(
    'flags an open "⬜" bullet using the inflected form "%s"',
    (verb) => {
      const content = `- ⬜ **${verb} \`v1.24.1\`** — maintainer action.`;
      const findings = scanForDrift(content, 'FAKE.md', actual);
      expect(findings.some((f) => f.includes('v1.24.1'))).toBe(true);
    },
  );

  it('does not flag an open "⬜" bullet for tagging a version newer than the latest release', () => {
    const content = '- ⬜ **Tag `v1.25.0` + publish the GitHub Release** — maintainer action.';
    const findings = scanForDrift(content, 'FAKE.md', actual);
    expect(findings).toHaveLength(0);
  });

  it('does not flag any version-based drift when latestVersion is null (shallow/tagless checkout)', () => {
    const content = [
      '- ⬜ **Tag `v1.24.1` + publish the GitHub Release** — maintainer action.',
      '## Upcoming — v1.0 (PLANNED)',
    ].join('\n');
    const findings = scanForDrift(content, 'FAKE.md', { ...actual, latestVersion: null });
    expect(findings).toHaveLength(0);
  });
});

// QNBS-v3 (F-10): regression guard for the dead worldscript-studio-indol.vercel.app URL that had
// leaked into the in-app link and the Italian locale — this is the check that would have caught it.
describe('getCanonicalProductionUrl', () => {
  it('reads a real https://….vercel.app/ URL from constants/brand.ts', () => {
    const url = getCanonicalProductionUrl();
    expect(url).toMatch(/^https:\/\/worldscript-studio[a-z0-9-]*\.vercel\.app\/$/);
  });
});

describe('scanForUrlDrift', () => {
  const canonical = 'https://worldscript-studio.vercel.app/';

  it('flags a Vercel URL that does not match the canonical one', () => {
    const content = 'Production: https://worldscript-studio-indol.vercel.app/';
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('worldscript-studio-indol.vercel.app');
  });

  it('does not flag the canonical URL', () => {
    const content = `Production: ${canonical}`;
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(0);
  });

  it('does not flag the canonical URL without a trailing slash', () => {
    const content = 'Production: https://worldscript-studio.vercel.app';
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(0);
  });

  it('ignores a mismatched URL inside a historical section', () => {
    const content = [
      '## [1.20.0]',
      '',
      'Was at https://worldscript-studio-old-preview.vercel.app/',
    ].join('\n');
    const findings = scanForUrlDrift(content, 'FAKE.md', canonical);
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (CodeRabbit): locales/it/help.json references the host with no `https://` prefix
  // (inside a <code> tag) — the scheme must be optional or this exact drift shape goes undetected.
  it('flags a scheme-less stale Vercel hostname', () => {
    const content = 'URL di produzione: <code>worldscript-studio-indol.vercel.app</code>';
    const findings = scanForUrlDrift(content, 'FAKE.json', canonical);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('worldscript-studio-indol.vercel.app');
  });

  it('does not flag the canonical hostname without a scheme', () => {
    const content = 'URL di produzione: <code>worldscript-studio.vercel.app</code>';
    const findings = scanForUrlDrift(content, 'FAKE.json', canonical);
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (CodeRabbit): scanForUrlDrift's finding COUNT can't distinguish "correctly didn't
  // match" from "matched a truncated substring that happened to equal canonical" — both give 0
  // findings, silently. Assert the pattern's own match behavior directly instead: without hostname
  // boundaries it would extract "worldscript-studio.vercel.app" out of these unrelated domains and
  // treat it as equivalent to canonical, which is the actual bug CodeRabbit flagged.
  describe('VERCEL_URL_PATTERN hostname boundaries', () => {
    function matches(text: string) {
      VERCEL_URL_PATTERN.lastIndex = 0;
      return VERCEL_URL_PATTERN.test(text);
    }

    it('does not match a canonical-host-suffixed lookalike domain', () => {
      expect(matches('https://worldscript-studio.vercel.app.evil.com/login')).toBe(false);
    });

    it('does not match a canonical-host-prefixed lookalike domain', () => {
      expect(matches('https://notworldscript-studio.vercel.app/')).toBe(false);
    });

    it('still matches the plain canonical host', () => {
      expect(matches('https://worldscript-studio.vercel.app/')).toBe(true);
    });

    it('still matches the -indol dead-preview host (hyphenated variant)', () => {
      expect(matches('https://worldscript-studio-indol.vercel.app/')).toBe(true);
    });
  });
});

// QNBS-v3 (audit F-1): a security doc asserting a PR is "the active remediation" or work is
// "pending"/"in progress on" that PR must say so truthfully — this gate exists because
// docs/SECURITY-THREAT-MODEL.md said exactly that about PR #356 for weeks after it closed.
describe('scanSecurityDocPrStatus', () => {
  it('flags an unqualified "is the active remediation" claim', () => {
    const content =
      '| Threat | [PR #356](https://github.com/qnbs/WorldScript-Studio/pull/356) is the active remediation | Loc |';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('docs/SECURITY-THREAT-MODEL.md:1');
  });

  it('flags an unqualified "pending [PR #NNN]" claim', () => {
    const content =
      "remain only as shared crypto plumbing pending [PR #356](https://github.com/qnbs/WorldScript-Studio/pull/356)'s project-data encryption work.";
    const findings = scanSecurityDocPrStatus(content, 'docs/IDB-ENCRYPTION.md');
    expect(findings).toHaveLength(1);
  });

  it('flags an unqualified "in progress on PR #NNN" claim', () => {
    const content = 'Encryption work is in progress on PR #356.';
    const findings = scanSecurityDocPrStatus(content, 'docs/IDB-ENCRYPTION.md');
    expect(findings).toHaveLength(1);
  });

  it('does not flag the same claim once qualified as closed/superseded on the same line', () => {
    const content =
      'PR #356 is the active remediation for the prior (now inaccurate) history — PR #356 was later closed as superseded by R-15.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  it('does not flag a bare historical PR citation with no live-status verb', () => {
    const content =
      'it remains in fsCore.ts as shared crypto plumbing for other filesystem-encrypted data (see [PR #356](https://github.com/qnbs/WorldScript-Studio/pull/356), closed 2026-08-18 as superseded).';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  it('does not flag "pending" prose with no PR-number anchor', () => {
    const content =
      'Full at-rest protection for the desktop filesystem store is pending R-15 implementation.';
    const findings = scanSecurityDocPrStatus(content, 'docs/IDB-ENCRYPTION.md');
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (CodeAnt): a naive per-physical-line split let a status claim soft-wrapped across two
  // Markdown lines within the same paragraph evade detection entirely.
  it('flags a claim even when Markdown wraps it across two physical lines of one paragraph', () => {
    const content = [
      'Desktop plaintext persistence remains open. [PR #356](https://github.com/qnbs/pull/356)',
      'is the active remediation for this gap.',
    ].join('\n');
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('PR #356');
  });

  // QNBS-v3 (CodeAnt): the qualifier must be tied to the SAME PR number, not merely present
  // anywhere in the sentence/line — otherwise a different, already-closed PR mentioned nearby
  // would wrongly suppress a live claim about an unrelated, still-unqualified PR.
  it('still flags an unqualified claim when a DIFFERENT PR is closed nearby', () => {
    const content =
      'PR #999 is the active remediation for this gap, unlike PR #111 which was already closed.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('PR #999');
  });

  // QNBS-v3 (codex): the original three-alternative regex required an exact word order and missed
  // common natural phrasings — the fix is order-independent (trigger phrase near a PR reference).
  it.each([
    'The active remediation is PR #356 for this gap.',
    'PR #356 remains the active remediation for this gap.',
    'Work is pending on PR #356 for this gap.',
  ])('flags the natural-language variant: %s', (content) => {
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('PR #356');
  });

  // QNBS-v3 (codex): consecutive Markdown table rows have no blank line between them — joining
  // them into one paragraph let a live claim in one row absorb an unrelated row's qualifier.
  it("does not let one table row's qualifier suppress a different row's unqualified claim", () => {
    const content = ['| PR #356 was closed |', '| PR #999 is the active remediation |'].join('\n');
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('PR #999');
  });

  // QNBS-v3 (codex): a long markdown-link URL between the PR reference and its qualifier must not
  // make a genuinely, explicitly qualified claim look unqualified.
  it('does not flag a claim qualified via a Markdown link with a long URL', () => {
    const content =
      '[PR #356](https://github.com/qnbs/WorldScript-Studio/pull/356) is the active remediation, but was closed.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (codex): a raw character-window qualifier check let a SHORT, unrelated PR's qualifier
  // suppress a different PR's unqualified claim when both PRs sat close together. Nearest-PR
  // association (not "any qualifier within the window") is required.
  it('still flags an unqualified claim when a nearby DIFFERENT PR is closed right next to it', () => {
    const content = '[PR #999] is the active remediation, unlike [PR #111], closed.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('PR #999');
  });

  // QNBS-v3 (codex): consecutive Markdown list items have no blank line between them either —
  // joining them let an unrelated later item's trigger word attach to an earlier item's PR.
  it("does not let one list item's wording attach to a different item's PR reference", () => {
    const content = ['- Historical context: PR #356', '- R-15 implementation is pending'].join(
      '\n',
    );
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (codex): a semicolon does not end a sentence — splitting on it separated a claim from
  // its own qualifying clause.
  it('does not flag a claim whose qualifier follows a semicolon in the same sentence', () => {
    const content = 'PR #356 is the active remediation; it was later closed as superseded.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (coderabbit/codex): a list item's own text may soft-wrap across the following
  // physical line — an immediate push-per-marker-line split it before the trigger was reached.
  it('flags a live-status claim wrapped across a list item', () => {
    const content = ['- PR `#356` is', '  the active remediation for this gap'].join('\n');
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  it('flags a Markdown-link PR reference wrapped across a list item', () => {
    const content = [
      '- [PR #999](https://github.com/qnbs/pull/999)',
      'is the active remediation',
    ].join('\n');
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  // QNBS-v3 (codex): "is not closed" / "will be merged" don't assert a completed status — only an
  // unnegated, non-prospective qualifier actually proves the PR is done.
  it('still flags a claim whose only nearby qualifier is negated', () => {
    const content = 'PR #999 is the active remediation; it is not closed.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  it('still flags a claim whose only nearby qualifier is prospective (future tense)', () => {
    const content = 'PR #999 is the active remediation and will be merged soon.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  it('does not flag a claim with a genuinely completed (non-negated) qualifier', () => {
    const content = 'PR #999 is the active remediation; it was later closed.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (codex): a negated or "no longer" trigger phrase explicitly denies live status — it
  // isn't a claim at all.
  it.each([
    'PR #356 is not the active remediation for this gap.',
    'PR #356 is no longer the active remediation for this gap.',
    'Work is not in progress on PR #356 for this gap.',
  ])('does not flag a negated trigger: %s', (content) => {
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  // QNBS-v3 (codex): compound negation/auxiliary forms around a qualifier must not be accepted as
  // proof of a completed status.
  it.each([
    'PR #999 is the active remediation; it has not been closed.',
    'PR #999 is the active remediation; it is not yet closed.',
    'PR #999 is the active remediation and may be merged eventually.',
  ])('still flags a claim with compound-negated/prospective qualifier: %s', (content) => {
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  // QNBS-v3 (codex): an HTML comment or fenced code block is never rendered prose — a literal
  // example inside one isn't a live assertion about a real PR.
  it('does not flag trigger wording inside an HTML comment', () => {
    const content = '<!-- Do not write: PR #999 is the active remediation -->\nReal prose here.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  it('does not flag trigger wording inside a fenced code block', () => {
    const content = ['```', 'PR #999 is the active remediation', '```'].join('\n');
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  it('still flags real prose surrounding a stripped HTML comment', () => {
    const content = [
      '<!-- internal note -->',
      'PR #999 is the active remediation for this gap.',
    ].join('\n');
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  // QNBS-v3 (coderabbit/codex): a negation word in an EARLIER clause must not suppress a
  // genuinely live, unqualified claim in a later clause of the same sentence — a real
  // false-negative that let a stale claim escape the gate entirely.
  it('flags a claim when negation belongs to an earlier, unrelated clause', () => {
    const content = 'Desktop project data is not encrypted, so PR #356 is the active remediation.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  it('flags a claim when negation modifies a different word in an earlier clause', () => {
    const content = 'PR #356 is not complete, but remains the active remediation.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  // QNBS-v3 (codex): the bare "[#NNN](.../pull/NNN)" shorthand is the same convention already
  // used for issue links (e.g. "[#358](.../issues/358)") in these exact two docs — a stale claim
  // shouldn't evade the gate merely by using this link style instead of writing "PR #NNN".
  it('flags a live-status claim using the bare "[#N](.../pull/N)" shorthand', () => {
    const content =
      '[#356](https://github.com/qnbs/WorldScript-Studio/pull/356) is the active remediation.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(1);
  });

  it('does not treat a bare "[#N](.../issues/N)" shorthand as a PR reference', () => {
    const content =
      'Closing [#358](https://github.com/qnbs/WorldScript-Studio/issues/358) is the active remediation.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });

  it('does not misattribute a mismatched "[#N](.../pull/M)" shorthand pair', () => {
    const content =
      '[#356](https://github.com/qnbs/WorldScript-Studio/pull/999) is the active remediation.';
    const findings = scanSecurityDocPrStatus(content, 'docs/SECURITY-THREAT-MODEL.md');
    expect(findings).toHaveLength(0);
  });
});
