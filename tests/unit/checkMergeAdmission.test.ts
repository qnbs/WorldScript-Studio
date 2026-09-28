// @vitest-environment node
/**
 * Regression tests for the exact PR-merge proof that prevents branch-local release truth from
 * passing PR CI and failing only after the merge reaches main.
 */

import { readFileSync } from 'node:fs';
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
  scanMergeAdmissionTruth: (input: {
    changelog: string;
    postReleaseCommitSubjects: string[];
    packageVersion: string;
    taggedVersions: Set<string>;
    branchLocalIndices: Set<number>;
    mergeCommitIndices: Set<number>;
    prNumber: number;
    prTitle: string;
  }) => string[];
  scanDirectMainMergeTruth: (input: {
    changelog: string;
    mergeBranches: Array<{
      mergeSubject: string;
      sideRecords: Array<{ subject: string; parents: string[] }>;
    }>;
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

describe('scanMergeAdmissionTruth', () => {
  type AdmissionInput = Parameters<DocMetricsModule['scanMergeAdmissionTruth']>[0];
  const subjects = [
    'feat(core): durable authority bootstrap',
    'fix(core): preserve diagnostics for lost root keys',
    'fix(core): block provisioning after indexed key loss',
  ];
  const admissionInput = (overrides: Partial<AdmissionInput> = {}): AdmissionInput => ({
    changelog: '## [Unreleased]\n\n- Durable authority bootstrap. PR #855.\n',
    postReleaseCommitSubjects: subjects,
    packageVersion: '1.28.8',
    taggedVersions: new Set(['1.28.8']),
    branchLocalIndices: new Set([0, 1, 2]),
    mergeCommitIndices: new Set(),
    prNumber: 855,
    prTitle: 'feat(core): Gate 1b durable authority bootstrap',
    ...overrides,
  });

  it('accepts multiple internal governed commits under one logical PR entry', async () => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(scanMergeAdmissionTruth(admissionInput())).toEqual([]);
  });

  it('slug-checks an integrated merge commit instead of trusting its umbrella issue suffix', async () => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(
      scanMergeAdmissionTruth(
        admissionInput({
          postReleaseCommitSubjects: [
            'feat(core): Gate 1b durable authority bootstrap (#445)',
            ...subjects.slice(1),
          ],
          branchLocalIndices: new Set([1, 2]),
          mergeCommitIndices: new Set([0]),
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a governed PR when its logical entry is missing', async () => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(
      scanMergeAdmissionTruth(
        admissionInput({ changelog: '## [Unreleased]\n\n- Unrelated change. PR #999.\n' }),
      ),
    ).toEqual([expect.stringContaining('logical PR #855')]);
  });

  it('rejects a correct PR number when the logical entry does not match the title', async () => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(
      scanMergeAdmissionTruth(
        admissionInput({ changelog: '## [Unreleased]\n\n- Unrelated cleanup. PR #855.\n' }),
      ),
    ).toEqual([expect.stringContaining('does not match prospective merge subject')]);
  });

  it('matches the actual squash subject when the title already has an issue suffix', async () => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(
      scanMergeAdmissionTruth(
        admissionInput({
          changelog: '## [Unreleased]\n\n- Search support. PR #900.\n',
          prNumber: 900,
          prTitle: 'feat(core): search support (#445)',
          postReleaseCommitSubjects: ['feat(core): search support'],
          branchLocalIndices: new Set([0]),
        }),
      ),
    ).toEqual([]);
  });

  it('does not require a release note for a non-governed PR title', async () => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(
      scanMergeAdmissionTruth(
        admissionInput({
          changelog: '## [Unreleased]\n',
          prNumber: 856,
          prTitle: 'docs(core): reconcile post-merge changelog history',
        }),
      ),
    ).toEqual([]);
  });

  it('still validates integrated base history for a non-governed PR', async () => {
    const { scanMergeAdmissionTruth } = await loadDocMetricsModule();
    expect(
      scanMergeAdmissionTruth(
        admissionInput({
          changelog: '## [Unreleased]\n',
          postReleaseCommitSubjects: [
            'feat(core): already merged change',
            'docs(core): reconcile post-merge changelog history',
          ],
          branchLocalIndices: new Set([1]),
          prNumber: 856,
          prTitle: 'docs(core): reconcile post-merge changelog history',
        }),
      ),
    ).toEqual([expect.stringContaining('1 commit(s) exist after the latest release tag')]);
  });
});

describe('scanDirectMainMergeTruth', () => {
  it('rejects governed side-parent commits behind a noncanonical merge subject', async () => {
    const { scanDirectMainMergeTruth } = await loadDocMetricsModule();
    expect(
      scanDirectMainMergeTruth({
        changelog: '## [Unreleased]\n\n- Unrelated cleanup. PR #999.\n',
        mergeBranches: [
          {
            mergeSubject: 'Merge branch feature',
            sideRecords: [{ subject: 'feat(core): hidden side change', parents: [] }],
          },
        ],
      }),
    ).toEqual([expect.stringContaining('hides 1 governed side-parent commit')]);
  });

  it('covers internal side-parent commits when the integrated subject has a matching entry', async () => {
    const { scanDirectMainMergeTruth } = await loadDocMetricsModule();
    expect(
      scanDirectMainMergeTruth({
        changelog: '## [Unreleased]\n\n- Durable authority bootstrap. PR #855.\n',
        mergeBranches: [
          {
            mergeSubject: 'feat(core): durable authority bootstrap (#445)',
            sideRecords: [
              { subject: 'feat(core): add durable authority bootstrap', parents: [] },
              { subject: 'fix(core): preserve diagnostics for lost root keys', parents: [] },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
});
