import { describe, expect, it, vi } from 'vitest';
import { expectedTagCommitSha, verifyRemoteTag } from '../../../scripts/signing/verify-remote.mjs';

const tagObjectSha = 'a'.repeat(40);
const pushedCommitSha = 'b'.repeat(40);
const retargetedCommitSha = 'c'.repeat(40);

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function tagFetch(targetSha = pushedCommitSha) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }))
    .mockResolvedValueOnce(
      jsonResponse({
        object: { sha: targetSha, type: 'commit' },
        verification: { verified: true, reason: 'valid' },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        sha: targetSha,
        commit: { message: 'release', verification: { verified: true, reason: 'valid' } },
      }),
    );
}

describe('release tag event binding', () => {
  it('requires the push event target and github.sha to agree', () => {
    expect(expectedTagCommitSha(pushedCommitSha, pushedCommitSha)).toBe(pushedCommitSha);
    expect(() => expectedTagCommitSha(pushedCommitSha, retargetedCommitSha)).toThrow(
      /does not match github\.sha/,
    );
    expect(() => expectedTagCommitSha('not-a-sha', pushedCommitSha)).toThrow(/full tag target/);
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
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
});
