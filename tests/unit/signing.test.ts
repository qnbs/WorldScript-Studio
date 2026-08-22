import { describe, expect, it } from 'vitest';
import {
  classifyCommitObject,
  classifyTagVerification,
  getSigningConfig,
  hasCommitSignature,
  isGitHubCompatibleEmail,
  parseRefUpdate,
  selectIntroducedCommits,
} from '../../scripts/signing/signing-core.mjs';
import {
  hasCompleteCommitRange,
  verifyRemoteCommitReports,
  verifyRemotePullRequest,
  verifyRemoteTag,
} from '../../scripts/signing/verify-remote.mjs';

describe('local signing controls', () => {
  it('parses every pre-push update shape, including deletion', () => {
    expect(parseRefUpdate('refs/heads/main abc refs/heads/main')).toEqual({
      localRef: 'refs/heads/main',
      localSha: 'abc',
      remoteRef: 'refs/heads/main',
    });
    expect(
      parseRefUpdate(
        '0000000000000000000000000000000000000000 0000000000000000000000000000000000000000 refs/heads/deleted',
      ),
    ).toEqual({
      localRef: '0000000000000000000000000000000000000000',
      localSha: '0000000000000000000000000000000000000000',
      remoteRef: 'refs/heads/deleted',
    });
    expect(parseRefUpdate('not enough')).toBeNull();
  });

  it('checks only commits introduced beyond the remote tracking base', () => {
    const base = 'a'.repeat(40);
    const introduced = 'b'.repeat(40);
    expect(selectIntroducedCommits([base, introduced], [base])).toEqual([introduced]);
  });

  it('requires both an annotated tag signature and its target commit signature', () => {
    const unsignedCommit = { ok: false, reason: 'commit has no signature object' };
    expect(
      classifyTagVerification({
        objectType: 'tag',
        targetType: 'commit',
        tagVerificationStatus: 0,
        commitVerification: unsignedCommit,
      }),
    ).toEqual(unsignedCommit);
    expect(
      classifyTagVerification({
        objectType: 'tag',
        targetType: 'commit',
        tagVerificationStatus: 1,
        commitVerification: { ok: true, reason: 'verified' },
      }),
    ).toMatchObject({ ok: false });
  });

  it('distinguishes unsigned and malformed signed commit objects', () => {
    expect(
      classifyCommitObject({ objectType: 'commit', contents: '', verificationStatus: 0 }),
    ).toMatchObject({ ok: false, reason: 'commit has no signature object' });
    expect(hasCommitSignature('\ngpgsig -----BEGIN SSH SIGNATURE-----\n')).toBe(true);
    expect(
      classifyCommitObject({
        objectType: 'commit',
        contents: '\ngpgsig malformed\n',
        verificationStatus: 1,
      }),
    ).toMatchObject({ ok: false, reason: 'Git-native signature verification failed' });
  });

  it('reports configuration and GitHub-compatible identity without a key fallback', () => {
    expect(getSigningConfig()).toHaveProperty('enabled');
    expect(isGitHubCompatibleEmail('155236708+qnbs@users.noreply.github.com')).toBe(true);
    expect(isGitHubCompatibleEmail('writer@example.com')).toBe(false);
  });
});

describe('GitHub signature API controls', () => {
  it('rejects any unverified commit while preserving safe report fields', () => {
    const result = verifyRemoteCommitReports([
      {
        sha: 'a'.repeat(40),
        commit: { message: 'signed', verification: { verified: true, reason: 'valid' } },
      },
      {
        sha: 'b'.repeat(40),
        commit: {
          message: 'unsigned\nbody',
          verification: { verified: false, reason: 'unsigned' },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bbbbbbbbbbbb: unsigned');
    expect(result.reports[1]).toEqual({
      sha: 'bbbbbbbbbbbb',
      subject: 'unsigned',
      verified: false,
      reason: 'unsigned',
    });
    expect(hasCompleteCommitRange(['a'.repeat(40), 'b'.repeat(40)], result.reports)).toBe(true);
    expect(hasCompleteCommitRange(['a'.repeat(40), 'c'.repeat(40)], result.reports)).toBe(false);
  });

  it('paginates PR commits and verifies annotated tags plus target commits', async () => {
    const verifiedCommit = (sha: string) => ({
      sha,
      commit: { message: 'commit', verification: { verified: true, reason: 'valid' } },
    });
    const pages = new Map([
      [
        'page=1',
        Array.from({ length: 100 }, (_, index) => verifiedCommit(String(index).padStart(40, '0'))),
      ],
      ['page=2', [verifiedCommit('f'.repeat(40))]],
    ]);
    const fetchImpl: typeof fetch = async (input) =>
      new Response(JSON.stringify(pages.get(String(input).split('&').pop() ?? '') ?? []), {
        status: 200,
      });
    const pullRequest = await verifyRemotePullRequest({
      owner: 'qnbs',
      repo: 'WorldScript-Studio',
      number: 1,
      fetchImpl,
    });
    expect(pullRequest.ok).toBe(true);
    expect(pullRequest.reports).toHaveLength(101);

    const tagObjectSha = '1'.repeat(40);
    const targetSha = '2'.repeat(40);
    const tagFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/git/ref/tags/'))
        return new Response(JSON.stringify({ object: { sha: tagObjectSha, type: 'tag' } }), {
          status: 200,
        });
      if (url.includes('/git/tags/'))
        return new Response(
          JSON.stringify({
            object: { sha: targetSha, type: 'commit' },
            verification: { verified: true, reason: 'valid' },
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify(verifiedCommit(targetSha)), { status: 200 });
    };
    const tag = await verifyRemoteTag({
      owner: 'qnbs',
      repo: 'WorldScript-Studio',
      tag: 'v1.0.0',
      fetchImpl: tagFetch,
    });
    expect(tag.ok).toBe(true);
    expect(tag.reports).toHaveLength(2);
  });
});
