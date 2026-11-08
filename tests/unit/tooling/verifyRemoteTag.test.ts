import { describe, expect, it, vi } from 'vitest';
import { expectedTagCommitSha, verifyRemoteTag } from '../../../scripts/signing/verify-remote.mjs';

const tagObjectSha = 'a'.repeat(40);
const pushedCommitSha = 'b'.repeat(40);
const retargetedCommitSha = 'c'.repeat(40);
const changedTagObjectSha = 'd'.repeat(40);

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function tagFetch(
  targetSha = pushedCommitSha,
  tagVerified = true,
  commitVerified = true,
  {
    mainProtected = true,
    mainSha = targetSha,
    compareStatus = mainSha === targetSha ? 'identical' : 'ahead',
    compareBaseSha = targetSha,
    compareHeadSha = mainSha,
  } = {},
) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }))
    .mockResolvedValueOnce(
      jsonResponse({
        tag: 'v1.29.3',
        object: { sha: targetSha, type: 'commit' },
        verification: { verified: tagVerified, reason: tagVerified ? 'valid' : 'unsigned' },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        sha: targetSha,
        commit: {
          message: 'release',
          verification: { verified: commitVerified, reason: commitVerified ? 'valid' : 'unsigned' },
        },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ name: 'main', protected: mainProtected, commit: { sha: mainSha } }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        status: compareStatus,
        base_commit: { sha: compareBaseSha },
        head_commit: { sha: compareHeadSha },
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }));
}

describe('release tag event binding', () => {
  it('requires the push event target and github.sha to agree', () => {
    expect(expectedTagCommitSha(pushedCommitSha, pushedCommitSha)).toBe(pushedCommitSha);
    expect(() => expectedTagCommitSha(pushedCommitSha, retargetedCommitSha)).toThrow(
      /does not match github\.sha/,
    );
    expect(() => expectedTagCommitSha('not-a-sha', pushedCommitSha)).toThrow(/full tag target/);
    expect(() => expectedTagCommitSha('0'.repeat(40), '0'.repeat(40))).toThrow(/live tag target/);
  });

  it('accepts a verified annotated tag only when its target equals the pushed commit', async () => {
    const fetchImpl = tagFetch();
    const result = await verifyRemoteTag({
      owner: 'qnbs',
      repo: 'WorldScript-Studio',
      tag: 'v1.29.3',
      expectedCommitSha: pushedCommitSha,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('rejects a tag retargeted to a different commit before checking that commit', async () => {
    const fetchImpl = tagFetch(retargetedCommitSha);
    const result = await verifyRemoteTag({
      owner: 'qnbs',
      repo: 'WorldScript-Studio',
      tag: 'v1.29.3',
      expectedCommitSha: pushedCommitSha,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match the pushed event commit/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects an annotated tag object whose signed internal name differs from the pushed ref', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          tag: 'v1.29.2',
          object: { sha: pushedCommitSha, type: 'commit' },
          verification: { verified: true, reason: 'valid' },
        }),
      );

    await expect(
      verifyRemoteTag({
        owner: 'qnbs',
        repo: 'WorldScript-Studio',
        tag: 'v1.29.3',
        expectedCommitSha: pushedCommitSha,
        fetchImpl,
      }),
    ).rejects.toThrow(/tag name does not match the pushed ref/);
  });

  it('rejects a tag that moves while its signature is being checked', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          tag: 'v1.29.3',
          object: { sha: pushedCommitSha, type: 'commit' },
          verification: { verified: true, reason: 'valid' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sha: pushedCommitSha,
          commit: { message: 'release', verification: { verified: true, reason: 'valid' } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ name: 'main', protected: true, commit: { sha: pushedCommitSha } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'identical',
          base_commit: { sha: pushedCommitSha },
          head_commit: { sha: pushedCommitSha },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ object: { sha: changedTagObjectSha, type: 'tag' } }));

    await expect(
      verifyRemoteTag({
        owner: 'qnbs',
        repo: 'WorldScript-Studio',
        tag: 'v1.29.3',
        expectedCommitSha: pushedCommitSha,
        fetchImpl,
      }),
    ).rejects.toThrow(/changed during signature verification/);
  });

  it('rejects a signed commit that is not contained in protected main', async () => {
    const fetchImpl = tagFetch(pushedCommitSha, true, true, {
      mainSha: 'e'.repeat(40),
      compareStatus: 'behind',
    });

    await expect(
      verifyRemoteTag({
        owner: 'qnbs',
        repo: 'WorldScript-Studio',
        tag: 'v1.29.3',
        expectedCommitSha: pushedCommitSha,
        fetchImpl,
      }),
    ).rejects.toThrow(/not contained in protected main/);
  });

  it('rejects release provenance when main is not protected', async () => {
    const fetchImpl = tagFetch(pushedCommitSha, true, true, { mainProtected: false });

    await expect(
      verifyRemoteTag({
        owner: 'qnbs',
        repo: 'WorldScript-Studio',
        tag: 'v1.29.3',
        expectedCommitSha: pushedCommitSha,
        fetchImpl,
      }),
    ).rejects.toThrow(/protected main branch identity/);
  });

  it('rejects a missing expected SHA before resolving a mutable tag ref', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      verifyRemoteTag({
        owner: 'qnbs',
        repo: 'WorldScript-Studio',
        tag: 'v1.29.3',
        expectedCommitSha: '',
        fetchImpl,
      }),
    ).rejects.toThrow(/expected tag target/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects lightweight tags even when the ref points to the pushed commit', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: pushedCommitSha, type: 'commit' } }));
    const result = await verifyRemoteTag({
      owner: 'qnbs',
      repo: 'WorldScript-Studio',
      tag: 'v1.29.3',
      expectedCommitSha: pushedCommitSha,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not an annotated tag/);
  });

  it.each([
    ['an unsigned annotated tag', false, true],
    ['an unsigned target commit', true, false],
  ])('rejects %s', async (_label, tagVerified, commitVerified) => {
    const result = await verifyRemoteTag({
      owner: 'qnbs',
      repo: 'WorldScript-Studio',
      tag: 'v1.29.3',
      expectedCommitSha: pushedCommitSha,
      fetchImpl: tagFetch(pushedCommitSha, tagVerified, commitVerified),
    });

    expect(result.ok).toBe(false);
    expect(result.reports.some((report) => !report.verified)).toBe(true);
  });

  it('fails closed when the tag is missing or was deleted before lookup', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));
    await expect(
      verifyRemoteTag({
        owner: 'qnbs',
        repo: 'WorldScript-Studio',
        tag: 'v1.29.3',
        expectedCommitSha: pushedCommitSha,
        fetchImpl,
      }),
    ).rejects.toThrow(/GitHub API request failed \(404\)/);
  });
});
