// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BUILD_CHECK_JOB,
  BUILD_CHECK_WORKFLOW,
  classifyContainerPrecheck,
  type PrecheckJob,
  type PrecheckRun,
} from '../../../scripts/release-container-precheck.mjs';

const SHA = 'a'.repeat(40);
const URL = 'https://github.com/qnbs/WorldScript-Studio/actions/runs/1';
const NO_TRUSTED_RUN = `no push or dispatch run of ${BUILD_CHECK_WORKFLOW} on main`;
const run = (overrides: Partial<PrecheckRun> = {}): PrecheckRun => ({
  id: 1,
  head_sha: SHA,
  head_branch: 'main',
  event: 'push',
  path: BUILD_CHECK_WORKFLOW,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-11T10:00:00Z',
  html_url: URL,
  ...overrides,
});
const jobs = (conclusion: string | null): Record<string, PrecheckJob[]> => ({
  1: [{ name: BUILD_CHECK_JOB, conclusion }],
});

type Case = [string, PrecheckRun[] | null, Record<string, PrecheckJob[] | null>, string];

describe('release container precheck (#1223)', () => {
  it.each([
    ['a push run on main', run()],
    ['a dispatch run on main', run({ event: 'workflow_dispatch' })],
    [
      'a run whose path carries the main ref',
      run({ path: `${BUILD_CHECK_WORKFLOW}@refs/heads/main` }),
    ],
  ])('passes a successful build-check job of %s on the exact commit', (_name, trusted) => {
    expect(
      classifyContainerPrecheck({ sha: SHA, runs: [trusted], jobsByRun: jobs('success') }),
    ).toEqual({ ok: true, reason: 'PASS', runId: 1, url: URL });
  });

  const failures: Case[] = [
    ['no run exists', [], jobs('success'), NO_TRUSTED_RUN],
    ['the run list is unreadable', null, jobs('success'), NO_TRUSTED_RUN],
    [
      'the run is for another commit',
      [run({ head_sha: 'b'.repeat(40) })],
      jobs('success'),
      NO_TRUSTED_RUN,
    ],
    [
      'the run is from another workflow',
      [run({ path: '.github/workflows/docker.yml' })],
      jobs('success'),
      NO_TRUSTED_RUN,
    ],
    [
      'the run path carries another ref',
      [run({ path: `${BUILD_CHECK_WORKFLOW}@refs/heads/other` })],
      jobs('success'),
      NO_TRUSTED_RUN,
    ],
    // #1225 review: a pull_request run takes its workflow from the PR merge ref, so it never counts.
    [
      'only a pull_request run exists for the commit',
      [run({ event: 'pull_request', head_branch: 'main' })],
      jobs('success'),
      NO_TRUSTED_RUN,
    ],
    [
      'the push run is on another branch',
      [run({ head_branch: 'release/x' })],
      jobs('success'),
      NO_TRUSTED_RUN,
    ],
    [
      'the build is still running',
      [run({ status: 'in_progress', conclusion: null })],
      jobs(null),
      'is in_progress',
    ],
    [
      'the build was cancelled',
      [run({ conclusion: 'cancelled' })],
      jobs('cancelled'),
      'concluded cancelled',
    ],
    ['the build failed', [run({ conclusion: 'failure' })], jobs('failure'), 'concluded failure'],
    ['the job was skipped', [run()], jobs('skipped'), `job "${BUILD_CHECK_JOB}" concluded skipped`],
    ['the job is missing', [run()], { 1: [] }, 'has no'],
    ['the job list is unreadable', [run()], { 1: null }, 'has no'],
  ];

  it.each(failures)('fails when %s', (_name, runs, jobsByRun, reason) => {
    const result = classifyContainerPrecheck({ sha: SHA, runs, jobsByRun });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain(reason);
  });

  it('ignores a newer pull_request run and decides on the trusted main run', () => {
    const runs = [
      run({ conclusion: 'failure' }),
      run({
        id: 2,
        event: 'pull_request',
        head_branch: 'feature/x',
        created_at: '2026-11-11T11:00:00Z',
      }),
    ];

    expect(classifyContainerPrecheck({ sha: SHA, runs, jobsByRun: jobs('success') }).reason).toBe(
      'latest run 1 concluded failure',
    );
  });

  it('lets the newest run decide, so an older success cannot hide a later failure', () => {
    const runs = [run(), run({ id: 2, conclusion: 'failure', created_at: '2026-11-11T11:00:00Z' })];

    expect(classifyContainerPrecheck({ sha: SHA, runs, jobsByRun: jobs('success') }).reason).toBe(
      'latest run 2 concluded failure',
    );
  });

  it('reports a missing run URL as null', () => {
    const { html_url: _url, ...withoutUrl } = run();
    const result = classifyContainerPrecheck({
      sha: SHA,
      runs: [withoutUrl],
      jobsByRun: jobs('success'),
    });

    expect(result).toEqual({ ok: true, reason: 'PASS', runId: 1, url: null });
  });

  it('lets the newest attempt decide, so a failed rerun of an older run is not hidden', () => {
    const runs = [
      run({ conclusion: 'failure', run_started_at: '2026-11-11T12:00:00Z' }),
      run({ id: 2, created_at: '2026-11-11T11:00:00Z', run_started_at: '2026-11-11T11:00:00Z' }),
    ];

    expect(classifyContainerPrecheck({ sha: SHA, runs, jobsByRun: jobs('success') }).reason).toBe(
      'latest run 1 concluded failure',
    );
  });

  it('rejects a candidate that is not a full commit SHA, even with a matching run', () => {
    const result = classifyContainerPrecheck({
      sha: 'v1.29.5',
      runs: [run({ head_sha: 'v1.29.5' })],
      jobsByRun: jobs('success'),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'the candidate is not a 40-hex commit SHA',
      runId: null,
      url: null,
    });
  });
});
