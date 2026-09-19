// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  hasValidPathInstructionShape,
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
});
