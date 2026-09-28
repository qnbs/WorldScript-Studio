// @vitest-environment node
/**
 * Regression tests for the exact PR-merge proof that prevents branch-local release truth from
 * passing PR CI and failing only after the merge reaches main.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type MergeAdmissionModule = {
  validateMergeRef: (input: {
    currentHead: string;
    firstParent: string;
    secondParent: string;
    baseSha: string;
    headSha: string;
    computedTree: string;
    actualTree: string;
    githubSha?: string;
  }) => string[];
  validateCurrentBase: (input: { eventBaseSha?: string; currentMainSha?: string }) => string[];
  validateAdmissionWorkflow: (workflowText: string) => string[];
};

type DocMetricsModule = {
  getProspectiveSquashSubject: (input: {
    prTitle: string;
    prNumber: number;
    prCommitSubjects: string[];
  }) => string;
  getDirectMainSideBranchRecords: (
    repositoryRoot?: string,
  ) => Array<{ mergeSubject: string; sideRecords: Array<{ subject: string }> }> | null;
  scanMergeAdmissionTruth: (input: {
    changelog: string;
    packageVersion: string;
    taggedVersions: Set<string>;
    baseRecords: Array<{ sha: string; parents: string[]; subject: string }>;
    baseMergeBranches: Array<{
      mergeSubject: string;
      sideRecords: Array<{ sha: string; parents: string[]; subject: string }>;
    }>;
    prRecords: Array<{ sha: string; parents: string[]; subject: string }>;
    prNumber: number;
    prTitle: string;
    prHeadLabel: string;
  }) => string[];
};

// QNBS-v3: executable .mjs exports are loaded dynamically so tsgo does not infer an untyped module.
const mergeAdmissionModuleUrl = new URL('../../scripts/check-merge-admission.mjs', import.meta.url)
  .href;
const loadMergeAdmissionModule = async () =>
  (await import(mergeAdmissionModuleUrl)) as unknown as MergeAdmissionModule;
const loadDocMetricsModule = async () =>
  (await import('../../scripts/check-doc-metrics.mjs')) as unknown as DocMetricsModule;

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const merge = 'c'.repeat(40);
const tree = 'd'.repeat(40);

describe('validateMergeRef', () => {
  it('accepts the exact current base/head merge tree', async () => {
    const { validateMergeRef } = await loadMergeAdmissionModule();
    expect(
      validateMergeRef({
        currentHead: merge,
        firstParent: base,
        secondParent: head,
        baseSha: base,
        headSha: head,
        computedTree: tree,
        actualTree: tree,
        githubSha: merge,
      }),
    ).toEqual([]);
  });

  it('rejects a stale base or detached/non-merge checkout', async () => {
    const { validateMergeRef } = await loadMergeAdmissionModule();
    expect(
      validateMergeRef({
        currentHead: merge,
        firstParent: 'e'.repeat(40),
        secondParent: head,
        baseSha: base,
        headSha: head,
        computedTree: tree,
        actualTree: 'f'.repeat(40),
        githubSha: merge,
      }),
    ).toEqual([
      expect.stringContaining('checkout parents'),
      expect.stringContaining('differs from git merge-tree result'),
    ]);
  });
});

describe('validateCurrentBase', () => {
  it('accepts a merge proof whose base is the current origin/main', async () => {
    const { validateCurrentBase } = await loadMergeAdmissionModule();
    expect(validateCurrentBase({ eventBaseSha: base, currentMainSha: base })).toEqual([]);
  });

  it('rejects a merge proof after main advances', async () => {
    const { validateCurrentBase } = await loadMergeAdmissionModule();
    expect(validateCurrentBase({ eventBaseSha: base, currentMainSha: 'e'.repeat(40) })).toEqual([
      expect.stringContaining('is stale'),
    ]);
  });

  it('fails closed when current main cannot be resolved', async () => {
    const { validateCurrentBase } = await loadMergeAdmissionModule();
    expect(validateCurrentBase({ eventBaseSha: base })).toEqual([
      expect.stringContaining('origin/main SHA is unavailable'),
    ]);
  });
});

describe('validateAdmissionWorkflow', () => {
  it('accepts the canonical trusted run and rejects a control-flow wrapper', async () => {
    const { validateAdmissionWorkflow } = await loadMergeAdmissionModule();
    const workflow = readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    expect(validateAdmissionWorkflow(workflow)).toEqual([]);
    expect(
      validateAdmissionWorkflow(
        workflow.replace(
          '          set -euo pipefail\n          git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main"',
          '          if false; then\n          set -euo pipefail\n          fi\n          git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main"',
        ),
      ),
    ).toEqual([expect.stringContaining('canonical trusted evaluator run changed')]);
  });
});

describe('main-context release truth for prospective landings', () => {
  type CommitRecord = { sha: string; parents: string[]; subject: string };
  type AdmissionInput = Parameters<DocMetricsModule['scanMergeAdmissionTruth']>[0];
  const record = (subject: string, parents = ['p']): CommitRecord => ({
    sha: subject,
    parents,
    subject,
  });
  const unreleased = (...bullets: string[]) =>
    `## [Unreleased]\n\n${bullets.map((bullet) => `- ${bullet}`).join('\n')}\n`;
  const admission = (overrides: Partial<AdmissionInput> = {}): AdmissionInput => ({
    changelog: unreleased('Durable authority bootstrap. PR #855.'),
    packageVersion: '1.28.8',
    taggedVersions: new Set(['1.28.8']),
    baseRecords: [],
    baseMergeBranches: [],
    prRecords: [
      record('fix(core): block provisioning after indexed key loss'),
      record('feat(core): add Gate 1b durable authority bootstrap'),
    ],
    prNumber: 855,
    prTitle: 'feat(core): R-15 Gate 1b-platform Slice B — durable authority bootstrap (#445)',
    prHeadLabel: 'qnbs/feat/445-gate1b',
    ...overrides,
  });
  const hiddenSideCommit = (mergeSubject: string, subject: string) => ({
    mergeSubject,
    sideRecords: [record(subject)],
  });

  it('uses the commit subject for a one-commit squash and the PR title otherwise', async () => {
    const { getProspectiveSquashSubject } = await loadDocMetricsModule();
    expect(
      getProspectiveSquashSubject({
        prTitle: 'docs: t',
        prNumber: 7,
        prCommitSubjects: ['feat: c'],
      }),
    ).toBe('feat: c (#7)');
    expect(
      getProspectiveSquashSubject({
        prTitle: 'docs: t',
        prNumber: 7,
        prCommitSubjects: ['a', 'b'],
      }),
    ).toBe('docs: t (#7)');
  });

  it.each<[string, Partial<AdmissionInput>]>([
    ['one numbered entry covers internal review commits in both landings', {}],
    [
      'an issue-suffixed title lands as a numbered squash subject',
      {
        changelog: unreleased('Search support. PR #900.'),
        prNumber: 900,
        prTitle: 'feat(core): search support (#445)',
      },
    ],
    [
      'a non-governed PR with only non-governed commits',
      {
        changelog: unreleased('Earlier entry. PR #1.'),
        prRecords: [record('docs: a'), record('docs: b')],
        prTitle: 'docs(core): reconcile history',
      },
    ],
    [
      'a canonical base merge whose side commits are bound to its numbered entry',
      {
        baseRecords: [record('Merge pull request #858 from qnbs/x', ['p', 'q'])],
        baseMergeBranches: [
          hiddenSideCommit('Merge pull request #858 from qnbs/x', 'fix(ci): bind bootstrap'),
        ],
        changelog: unreleased(
          'Durable authority bootstrap. PR #855.',
          'Bootstrap binding. PR #858.',
        ),
      },
    ],
  ])('admits %s', async (_label, overrides) => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(scanMergeAdmissionTruth(admission(overrides))).toEqual([]);
  });

  it.each<[string, Partial<AdmissionInput>, string[]]>([
    [
      'a governed PR without its numbered entry',
      { changelog: unreleased('Unrelated change. PR #999.') },
      ['squash landing', 'merge-commit landing'],
    ],
    [
      'governed internal commits under a non-governed multi-commit title',
      { changelog: unreleased('Earlier entry. PR #1.'), prTitle: 'ci(governance): tidy' },
      ['merge-commit landing of PR #855 — CHANGELOG.md — direct-main merge'],
    ],
    [
      'a one-commit PR whose governed commit subject becomes the squash subject',
      {
        changelog: unreleased('Earlier entry. PR #1.'),
        prRecords: [record('feat(core): add search')],
        prTitle: 'docs: add search',
      },
      ['squash landing', 'merge-commit landing'],
    ],
    [
      'undocumented integrated base history under a non-governed title',
      {
        changelog: unreleased('Earlier entry. PR #1.'),
        baseRecords: [record('feat(core): already merged change')],
        prRecords: [record('docs: a')],
        prTitle: 'docs: a',
      },
      ['squash landing', 'merge-commit landing'],
    ],
    [
      'a base merge that would lose the entry the squash commit reserves',
      {
        changelog: unreleased('Search support. PR #900.'),
        baseRecords: [record('feat(core): search support', ['p', 'q'])],
        prNumber: 900,
        prTitle: 'feat(core): search support',
      },
      ['squash landing', 'merge-commit landing'],
    ],
    [
      'governed base side-parent history behind a noncanonical merge',
      {
        baseRecords: [record('Merge branch feature', ['p', 'q'])],
        baseMergeBranches: [hiddenSideCommit('Merge branch feature', 'feat(core): hidden change')],
      },
      ['squash landing', 'merge-commit landing'],
    ],
    [
      'one entry documenting both a numbered commit and a hidden side commit',
      {
        changelog: unreleased('Add durable authority bootstrap. PR #123.', 'Other. PR #855.'),
        baseRecords: [
          record('Merge branch feature', ['p', 'q']),
          record('feat(core): add durable authority bootstrap (#123)'),
        ],
        baseMergeBranches: [
          hiddenSideCommit('Merge branch feature', 'feat(core): add durable authority bootstrap'),
        ],
      },
      ['squash landing', 'merge-commit landing'],
    ],
  ])('rejects %s', async (_label, overrides, prefixes) => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    const findings = scanMergeAdmissionTruth(admission(overrides));
    expect(findings).toEqual(prefixes.map((prefix) => expect.stringContaining(prefix)));
  });
});

describe('getDirectMainSideBranchRecords', () => {
  it('lists each first-parent merge once with every commit it introduced', async () => {
    const { getDirectMainSideBranchRecords } = await loadDocMetricsModule();
    const repositoryRoot = mkdtempSync(join(process.cwd(), '.tmp-worldscript-side-parents-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repositoryRoot, ...args], {
        encoding: 'utf8',
        // QNBS-v3: the fixture must not inherit a developer's global signing, hooks, or editor config.
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      });
    const commitOn = (branch: string, subject: string) => {
      git('switch', '--quiet', '-C', branch, 'main');
      git('commit', '--quiet', '--allow-empty', '-m', subject);
    };
    try {
      git('init', '--quiet', '--initial-branch=main');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      git('config', 'commit.gpgsign', 'false');
      git('commit', '--quiet', '--allow-empty', '-m', 'init');
      git('tag', 'v1.0.0');
      commitOn('a', 'feat: alpha');
      commitOn('b', 'feat: beta');
      commitOn('c', 'fix: gamma');
      commitOn('e', 'fix: epsilon');
      commitOn('d', 'feat: delta');
      git('merge', '--quiet', '--no-ff', '-m', 'Merge e into d', 'e');
      git('switch', '--quiet', 'main');
      git('merge', '--quiet', '--no-ff', '-m', 'Octopus merge', 'a', 'b', 'c');
      git('merge', '--quiet', '--no-ff', '-m', 'Merge d', 'd');
      const merges = getDirectMainSideBranchRecords(repositoryRoot) ?? [];
      expect(
        merges.map(({ mergeSubject, sideRecords }) => [
          mergeSubject,
          sideRecords.map(({ subject }) => subject).sort(),
        ]),
      ).toEqual([
        ['Merge d', ['Merge e into d', 'feat: delta', 'fix: epsilon']],
        ['Octopus merge', ['feat: alpha', 'feat: beta', 'fix: gamma']],
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});
