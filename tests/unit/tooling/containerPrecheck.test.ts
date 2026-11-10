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
const run = (overrides: Partial<PrecheckRun> = {}): PrecheckRun => ({
  id: 1,
  head_sha: SHA,
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
  it('passes a successful build-check job on the exact commit', () => {
    expect(
      classifyContainerPrecheck({ sha: SHA, runs: [run()], jobsByRun: jobs('success') }),
    ).toEqual({ ok: true, reason: 'PASS', runId: 1, url: URL });
  });

  const failures: Case[] = [
    ['no run exists', [], jobs('success'), `no ${BUILD_CHECK_WORKFLOW} run`],
    ['the run list is unreadable', null, jobs('success'), `no ${BUILD_CHECK_WORKFLOW} run`],
    ['the run is for another commit', [run({ head_sha: 'b'.repeat(40) })], jobs('success'), 'no '],
    [
      'the run is from another workflow',
      [run({ path: '.github/workflows/docker.yml' })],
      jobs('success'),
      'no ',
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

  it('lets the newest run decide, so an older success cannot hide a later failure', () => {
    const runs = [run(), run({ id: 2, conclusion: 'failure', created_at: '2026-11-11T11:00:00Z' })];

    expect(classifyContainerPrecheck({ sha: SHA, runs, jobsByRun: jobs('success') }).reason).toBe(
      'latest run 2 concluded failure',
    );
  });

  it('rejects a candidate that is not a full commit SHA', () => {
    const result = classifyContainerPrecheck({
      sha: 'v1.29.5',
      runs: [run()],
      jobsByRun: jobs('success'),
    });

    expect(result.ok).toBe(false);
  });
});
