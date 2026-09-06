// @vitest-environment node
/**
 * Tests for scripts/check-doc-metrics.mjs
 * QNBS-v3: protects the drift gate from historical-section regressions — an untested exclusion heuristic would turn it into noise.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getCanonicalProductionUrl,
  getTaggedVersions,
  scanBundleBudgetTruth,
  scanForDrift,
  scanForUrlDrift,
  scanReadmeTestMetrics,
  scanReleaseTruth,
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
  ) => string[];
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

describe('bundle budget truth', () => {
  const budget = { entryKb: 2500, vendorKb: 6200, chunkKb: 2500, wasmKb: 30000 };
  const statement = [
    '<!-- bundle-budget:source-of-truth -->',
    'Raw bundle-budget ceilings (KB per uncompressed asset): entry **2500 KB**, vendor **6200 KB**, other JavaScript **2500 KB**, and WASM **30000 KB**.',
  ].join('\n');

  it('accepts a current source-of-truth statement', () => {
    expect(scanBundleBudgetTruth(statement, 'FAKE.md', budget)).toEqual([]);
  });

  it('rejects stale budget documentation', () => {
    expect(
      scanBundleBudgetTruth(statement.replace('2500 KB', '4500 KB'), 'FAKE.md', budget),
    ).toEqual([expect.stringContaining('does not match config/bundle-budget.json')]);
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
