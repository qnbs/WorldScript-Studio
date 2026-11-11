// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BUILD_CHECK_JOB,
  BUILD_CHECK_WORKFLOW,
  classifyContainerPrecheck,
  isPending,
  nextSleepSeconds,
  type PrecheckJob,
  type PrecheckRun,
  parseArgs,
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

// A complete run list: total_count equals the fetched runs unless a test says otherwise.
const precheck = (runs: PrecheckRun[], totalCount: number | null = runs.length) =>
  classifyContainerPrecheck({ sha: SHA, runs, totalCount, jobsByRun: jobs('success') });

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
      classifyContainerPrecheck({
        sha: SHA,
        runs: [trusted],
        totalCount: 1,
        jobsByRun: jobs('success'),
      }),
    ).toEqual({ ok: true, reason: 'PASS', runId: 1, url: URL });
  });

  const failures: Case[] = [
    ['no run exists', [], jobs('success'), NO_TRUSTED_RUN],
    ['the run list is unreadable', null, jobs('success'), 'the run list is unreadable'],
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
    const result = classifyContainerPrecheck({
      sha: SHA,
      runs,
      totalCount: runs?.length ?? null,
      jobsByRun,
    });

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

    expect(precheck(runs).reason).toBe('latest run 1 concluded failure');
  });

  it('lets the newest run decide, so an older success cannot hide a later failure', () => {
    const runs = [run(), run({ id: 2, conclusion: 'failure', created_at: '2026-11-11T11:00:00Z' })];

    expect(precheck(runs).reason).toBe('latest run 2 concluded failure');
  });

  it('reports a missing run URL as null', () => {
    const { html_url: _url, ...withoutUrl } = run();

    expect(precheck([withoutUrl])).toEqual({ ok: true, reason: 'PASS', runId: 1, url: null });
  });

  // #1223 follow-up (a): a newer failed run beyond the first page must not leave an older success in charge.
  it('fails closed when the API reports more runs than were fetched', () => {
    expect(precheck([run()], 101)).toEqual({
      ok: false,
      reason: 'the run list is incomplete: 1 of 101 runs fetched',
      runId: null,
      url: null,
    });
  });

  it.each([
    ['is missing', null],
    ['is negative', -1],
    ['is not an integer', 1.5],
  ])('fails closed when total_count %s', (_name, totalCount) => {
    expect(precheck([run()], totalCount).reason).toBe('the run list has no total_count');
  });

  it('fails closed when total_count is smaller than the fetched runs', () => {
    expect(precheck([run(), run({ id: 2 })], 1).reason).toBe(
      'the run list is incomplete: 2 of 1 runs fetched',
    );
  });

  it('lets the newest attempt decide, so a failed rerun of an older run is not hidden', () => {
    const runs = [
      run({ conclusion: 'failure', run_started_at: '2026-11-11T12:00:00Z' }),
      run({ id: 2, created_at: '2026-11-11T11:00:00Z', run_started_at: '2026-11-11T11:00:00Z' }),
    ];

    expect(precheck(runs).reason).toBe('latest run 1 concluded failure');
  });

  it('rejects a candidate that is not a full commit SHA, even with a matching run', () => {
    const result = classifyContainerPrecheck({
      sha: 'v1.29.5',
      runs: [run({ head_sha: 'v1.29.5' })],
      totalCount: 1,
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

// #1219: at tag time the precheck waits (bounded) while the build check of the commit is not finished.
describe('release container precheck wait (#1219)', () => {
  it.each([
    ['no run exists yet', [] as PrecheckRun[], true],
    ['the run list is unreadable', null, true],
    ['only a pull_request run exists', [run({ event: 'pull_request' })], true],
    ['the newest trusted run is queued', [run({ status: 'queued', conclusion: null })], true],
    [
      'the newest trusted run is in progress',
      [run({ status: 'in_progress', conclusion: null })],
      true,
    ],
    ['the newest trusted run succeeded', [run()], false],
    ['the newest trusted run failed', [run({ conclusion: 'failure' })], false],
    [
      'a newer rerun is still running after an older success',
      [
        run(),
        run({ id: 2, status: 'in_progress', conclusion: null, created_at: '2026-11-11T11:00:00Z' }),
      ],
      true,
    ],
  ])('decides whether to keep waiting when %s', (_name, runs, pending) => {
    expect(isPending(SHA, runs)).toBe(pending);
  });

  it.each([
    [['abc'], { sha: 'abc', waitSeconds: 0 }],
    [['--wait-seconds', '1200', 'abc'], { sha: 'abc', waitSeconds: 1200 }],
    [['abc', '--wait-seconds', '0'], { sha: 'abc', waitSeconds: 0 }],
  ])('parses %j', (argv, expected) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  // #1234 review: the last sleep stops at the deadline instead of overrunning it by up to one poll.
  it.each([
    [100_000, 0, 30],
    [12_000, 0, 12],
    [0, 5_000, 0],
  ])('sleeps %d ms deadline at %d ms for %d s', (deadline, now, seconds) => {
    expect(nextSleepSeconds(deadline, now)).toBe(seconds);
  });

  it.each([['-5'], ['1.5'], ['soon'], [''], [' 5'], ['1e3'], [undefined]])(
    'rejects --wait-seconds %s',
    (value) => {
      const argv =
        value === undefined ? ['abc', '--wait-seconds'] : ['--wait-seconds', value, 'abc'];
      expect(Number.isNaN(parseArgs(argv).waitSeconds)).toBe(true);
    },
  );
});
