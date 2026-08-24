import { describe, expect, it } from 'vitest';
import {
  classifyCommitObject,
  classifyTagVerification,
  getSigningConfig,
  hasCommitSignature,
  isGitHubCompatibleEmail,
  outgoingBaseShas,
  parsePrePushInput,
  parseRefUpdate,
  parseSerializedPrePushUpdates,
  pushCommitShas,
  pushEventRange,
  resolvePushEvidence,
  selectIntroducedCommits,
  serializePrePushUpdates,
  verifyOutgoingUpdates,
} from '../../scripts/signing/signing-core.mjs';
import {
  hasCompleteCommitRange,
  verifyRemoteCommitReports,
  verifyRemotePullRequest,
  verifyRemoteTag,
} from '../../scripts/signing/verify-remote.mjs';

describe('local signing controls', () => {
  it('parses every pre-push update shape, including deletion', () => {
    const remoteSha = 'c'.repeat(40);
    expect(
      parseRefUpdate(`refs/heads/main ${'a'.repeat(40)} refs/heads/main ${remoteSha}`),
    ).toEqual({
      localRef: 'refs/heads/main',
      localSha: 'a'.repeat(40),
      remoteRef: 'refs/heads/main',
      remoteSha,
    });
    expect(
      parseRefUpdate(`refs/heads/deleted ${'0'.repeat(40)} refs/heads/deleted ${'d'.repeat(40)}`),
    ).toEqual({
      localRef: 'refs/heads/deleted',
      localSha: '0'.repeat(40),
      remoteRef: 'refs/heads/deleted',
      remoteSha: 'd'.repeat(40),
    });
    expect(parseRefUpdate('refs/heads/main abc refs/heads/main')).toBeNull();
  });

  it('round-trips one canonical structured update stream for both consumers', () => {
    const updates = parsePrePushInput(
      `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}\n`,
    );
    expect(parseSerializedPrePushUpdates(serializePrePushUpdates(updates))).toEqual(updates);
  });

  it('resolves committed paths independently of a clean or dirty worktree', () => {
    const update = parseRefUpdate(
      `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,
    )!;
    const result = resolvePushEvidence([update], process.cwd(), {
      commitExists: () => true,
      changedFilesBetween: () => ['src/with\nnewline.ts', '世界 file.ts', 'with\t tab.ts'],
    });
    expect(result).toMatchObject({ evidenceState: 'RESOLVED' });
    expect(result.changedFiles).toEqual(['src/with\nnewline.ts', '世界 file.ts', 'with\t tab.ts']);
  });

  it('handles new branches, deletions, multiple refs, and invalid input explicitly', () => {
    const zero = '0'.repeat(40);
    const branch = parseRefUpdate(`refs/heads/new ${'a'.repeat(40)} refs/heads/new ${zero}`)!;
    const deletion = parseRefUpdate(`refs/heads/old ${zero} refs/heads/old ${'b'.repeat(40)}`)!;
    const result = resolvePushEvidence([branch, deletion], process.cwd(), {
      commitExists: () => true,
      changedFilesBetween: (base) =>
        base === '4b825dc642cb6eb9a060e54bf8d69288fbee4904' ? ['new.ts'] : [],
    });
    expect(result.evidenceState).toBe('RESOLVED');
    expect(result.updates.map(({ disposition }) => disposition)).toEqual(['NEW_BRANCH', 'DELETED']);
    expect(result.changedFiles).toEqual(['new.ts']);
    expect(resolvePushEvidence('malformed').evidenceState).toBe('INVALID');
  });

  it('fails closed for missing objects and Git path-resolution failures', () => {
    const update = parseRefUpdate(
      `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,
    )!;
    expect(resolvePushEvidence([update]).evidenceState).toBe('INVALID');
    expect(
      resolvePushEvidence([update], process.cwd(), {
        commitExists: () => true,
        changedFilesBetween: () => {
          throw new Error('git diff failed');
        },
      }).evidenceState,
    ).toBe('INVALID');
  });

  it('checks only commits introduced beyond the remote tracking base', () => {
    const base = 'a'.repeat(40);
    const introduced = 'b'.repeat(40);
    expect(selectIntroducedCommits([base, introduced], [base])).toEqual([introduced]);
  });

  it('uses the Git-advertised remote SHA before new-branch fallbacks', () => {
    const remoteSha = 'c'.repeat(40);
    const fallback = ['d'.repeat(40)];
    expect(
      outgoingBaseShas(
        {
          localRef: 'refs/heads/main',
          localSha: 'a'.repeat(40),
          remoteRef: 'refs/heads/main',
          remoteSha,
        },
        fallback,
      ),
    ).toEqual([remoteSha]);
    expect(
      outgoingBaseShas(
        {
          localRef: 'refs/heads/new',
          localSha: 'a'.repeat(40),
          remoteRef: 'refs/heads/new',
          remoteSha: '0'.repeat(40),
        },
        fallback,
      ),
    ).toEqual(fallback);
  });

  it('covers deletion, malformed, tag, and branch pre-push routing', () => {
    const zero = '0'.repeat(40);
    const commit = 'a'.repeat(40);
    const remote = 'b'.repeat(40);
    expect(
      verifyOutgoingUpdates(
        [`refs/heads/deleted ${zero} refs/heads/deleted ${remote}`],
        'origin',
        process.cwd(),
        {
          introducedCommits: () => {
            throw new Error('deletions must be skipped');
          },
        },
      ),
    ).toMatchObject({ ok: true, reports: [] });
    expect(verifyOutgoingUpdates(['malformed'], 'origin')).toMatchObject({
      ok: false,
      reason: 'invalid pre-push ref-update input',
    });
    expect(
      verifyOutgoingUpdates(
        [`refs/tags/v1.0.0 ${commit} refs/tags/v1.0.0 ${zero}`],
        'origin',
        process.cwd(),
        {
          verifyTagObject: () => ({ ok: true, reason: 'tag and target commit verified' }),
          introducedCommits: () => {
            throw new Error('tags must not enumerate branch commits');
          },
        },
      ),
    ).toMatchObject({ ok: true, reports: [{ sha: commit, subject: 'refs/tags/v1.0.0' }] });
    expect(
      verifyOutgoingUpdates(
        [`refs/heads/main ${commit} refs/heads/main ${remote}`],
        'origin',
        process.cwd(),
        {
          introducedCommits: (update) => {
            expect(update.remoteSha).toBe(remote);
            return [commit];
          },
          verifyCommitObject: () => ({ ok: true, reason: 'Git-native signature verified' }),
        },
      ),
    ).toMatchObject({ ok: true, reports: [{ sha: commit }] });
  });

  it('derives an exact push range and rejects an unverified earlier commit', () => {
    const before = '0'.repeat(40);
    const after = 'f'.repeat(40);
    expect(pushEventRange({ before, after })).toEqual({ before, after });
    expect(
      pushCommitShas({ before: '1'.repeat(40), after }, process.cwd(), () => [
        '1'.repeat(40),
        'e'.repeat(40),
        after,
      ]),
    ).toEqual(['1'.repeat(40), 'e'.repeat(40), after]);
    const result = verifyRemoteCommitReports([
      {
        sha: '1'.repeat(40),
        commit: { message: 'earlier', verification: { verified: false, reason: 'unsigned' } },
      },
      {
        sha: after,
        commit: { message: 'head', verification: { verified: true, reason: 'valid' } },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('111111111111: unsigned');
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
    expect(
      classifyTagVerification({
        objectType: 'commit',
        targetType: 'commit',
        tagVerificationStatus: 0,
        commitVerification: { ok: true, reason: 'verified' },
      }),
    ).toMatchObject({ ok: false, reason: 'release tag is not an annotated tag object' });
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

    const lightweight = await verifyRemoteTag({
      owner: 'qnbs',
      repo: 'WorldScript-Studio',
      tag: 'v1.0.0-lightweight',
      fetchImpl: async () =>
        new Response(JSON.stringify({ object: { sha: targetSha, type: 'commit' } }), {
          status: 200,
        }),
    });
    expect(lightweight.ok).toBe(false);
    expect(lightweight.reason).toContain('not an annotated tag object');
  });
});
