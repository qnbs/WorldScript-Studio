#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { commitsInRange, pushCommitShas } from './signing-core.mjs';
import {
  contextCommitSha,
  hasCompleteCommitRange,
  verifyRemoteCommitRange,
  verifyRemotePullRequest,
  verifyRemoteTag,
} from './verify-remote.mjs';

const [owner, repo] = String(process.env.GITHUB_REPOSITORY ?? '').split('/', 2);
const token = process.env.GITHUB_TOKEN ?? '';
const fetchImpl = fetch;
const event = process.env.GITHUB_EVENT_NAME ?? '';

function fail(message) {
  console.error(`signature gate failed: ${message}`);
  process.exit(1);
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) fail('GITHUB_EVENT_PATH is unavailable');
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (error) {
    fail(
      `cannot read GitHub event payload: ${error instanceof Error ? error.message : 'invalid JSON'}`,
    );
  }
}

if (!owner || !repo) fail('GITHUB_REPOSITORY is unavailable');

try {
  let result;
  if (event === 'pull_request') {
    const payload = readEventPayload();
    const number = payload.pull_request?.number;
    const before = payload.pull_request?.base?.sha;
    const after = payload.pull_request?.head?.sha;
    if (!number || !before || !after)
      fail('pull request payload is missing its exact before/after SHAs');
    const expected = new Set(commitsInRange(`${before}..${after}`));
    result = await verifyRemotePullRequest({ owner, repo, number, token, fetchImpl });
    if (!hasCompleteCommitRange([...expected], result.reports)) {
      fail('GitHub PR pagination did not cover the complete before..after commit range');
    }
  } else if (event === 'push' && process.env.GITHUB_REF_TYPE === 'tag') {
    const payload = readEventPayload();
    const tagName = process.env.GITHUB_REF_NAME ?? '';
    if (payload.ref !== `refs/tags/${tagName}` || !tagName.startsWith('v'))
      fail('push event ref does not match the requested version tag');
    const expectedCommitSha = contextCommitSha(process.env.GITHUB_SHA);
    result = await verifyRemoteTag({
      owner,
      repo,
      tag: tagName,
      expectedCommitSha,
      eventAfter: payload.after,
      token,
      fetchImpl,
    });
  } else {
    const shas = pushCommitShas(readEventPayload());
    result = await verifyRemoteCommitRange({ owner, repo, shas, token, fetchImpl });
  }
  for (const report of result.reports) {
    console.log(
      `${report.sha} ${report.verified ? 'verified' : 'REJECTED'} ${report.reason} ${report.subject}`,
    );
  }
  if (!result.ok) fail(result.reason);
} catch (error) {
  fail(error instanceof Error ? error.message : 'unexpected verification error');
}
