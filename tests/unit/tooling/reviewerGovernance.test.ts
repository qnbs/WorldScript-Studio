// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  hasEnabledAutoReview,
  hasValidPathInstructionShape,
  hasValidReviewerRole,
  isForbiddenDynamicKey,
} from '../../../scripts/check-reviewer-config.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const reviewerStatusScript = fileURLToPath(
  new URL('../../../scripts/reviewer-status.mjs', import.meta.url),
);

describe('reviewer governance validators', () => {
  it('rejects compound current-provider state keys in every separator/case form', () => {
    expect(isForbiddenDynamicKey('currentProviderStatus')).toBe(true);
    expect(isForbiddenDynamicKey('CURRENT_PROVIDER_STATUS')).toBe(true);
    expect(isForbiddenDynamicKey('current-provider-status')).toBe(true);
    expect(isForbiddenDynamicKey('providerRole')).toBe(false);
  });

  it('requires a non-empty path for CodeRabbit path instructions', () => {
    expect(hasValidPathInstructionShape({ path: '', instructions: 'why' })).toBe(false);
    expect(hasValidPathInstructionShape({ path: '   ', instructions: 'why' })).toBe(false);
    expect(hasValidPathInstructionShape({ path: 'services/**', instructions: 'why' })).toBe(true);
    expect(hasValidPathInstructionShape({ instructions: 'why' })).toBe(false);
  });

  it('requires typed non-empty reviewer roles and boolean CodeRabbit auto-review', () => {
    expect(hasValidReviewerRole('semantic-ai-review')).toBe(true);
    expect(hasValidReviewerRole('  ')).toBe(false);
    expect(hasValidReviewerRole({})).toBe(false);
    expect(
      hasEnabledAutoReview({ auto_review: { enabled: true, auto_incremental_review: true } }),
    ).toBe(true);
    expect(
      hasEnabledAutoReview({ auto_review: { enabled: 'false', auto_incremental_review: true } }),
    ).toBe(false);
  });
});

describe('reviewer-status CLI validation', () => {
  it('rejects pull-request numbers outside the GitHub GraphQL Int range before API access', () => {
    const result = spawnSync(process.execPath, [reviewerStatusScript, '--pr', '2147483648'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('within GraphQL Int range');
  });

  it('rejects malformed repository targets before API access', () => {
    const result = spawnSync(
      process.execPath,
      [reviewerStatusScript, '--pr', '779', '--repo', 'qnbs/WorldScript-Studio/extra'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--repo must be exactly owner/name');
  });

  it('collects commit statuses from paginated status response objects', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'reviewer-status-gh-'));
    const fakeGh = join(tempDirectory, 'gh');
    writeFileSync(
      fakeGh,
      `#!/usr/bin/env node
const request = process.argv.slice(2).join(' ');
let response;
if (request.includes('graphql')) {
  response = [{
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [{
              id: 'thread-1',
              isResolved: false,
              isOutdated: false,
              path: 'scripts/example.mjs',
              line: 1,
              comments: { nodes: [{ databaseId: 42, author: { login: 'reviewer' }, body: 'metadata' }] },
            }],
          },
        },
      },
    },
  }];
} else if (request.includes('/check-runs?')) {
  response = [{ check_runs: [{ name: 'Provider\\nInjected', status: 'completed', conclusion: 'failure' }] }];
} else if (request.includes('/status?')) {
  response = [{ statuses: [{ id: 7, context: 'DeepSource', state: 'success', target_url: 'https://github.com/qnbs/WorldScript-Studio' }] }];
} else if (request.includes('/issues/779/comments') || request.includes('/pulls/779/comments') || request.includes('/pulls/779/reviews')) {
  response = [];
} else if (request.includes('/pulls/779')) {
  response = { head: { sha: 'test-head' }, state: 'open', merged: false, base: { ref: 'main' } };
} else {
  response = [];
}
process.stdout.write(JSON.stringify(response));
`,
    );
    chmodSync(fakeGh, 0o755);

    try {
      const result = spawnSync(process.execPath, [reviewerStatusScript, '--pr', '779'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${tempDirectory}:${process.env['PATH'] ?? ''}` },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('commitStatuses total=1');
      expect(result.stdout).toContain('context="DeepSource"');
      expect(result.stdout).toContain('rootCommentId=42');
      expect(result.stdout).toContain('checkName="Provider\\nInjected"');
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
