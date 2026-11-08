import { describe, expect, it, vi } from 'vitest';
import { expectedTagCommitSha, verifyRemoteTag } from '../../../scripts/signing/verify-remote.mjs';

const tagObjectSha = 'a'.repeat(40);
const pushedCommitSha = 'b'.repeat(40);
const retargetedCommitSha = 'c'.repeat(40);
const changedTagObjectSha = 'd'.repeat(40);
const newerMainSha = 'e'.repeat(40);
const unrelatedMergeBaseSha = 'f'.repeat(40);

type MainProvenanceOptions = {
  mainProtected?: boolean;
  mainSha?: string;
  mainAfterProtected?: boolean;
  mainAfterSha?: string;
  compareStatus?: string;
  compareBaseSha?: string;
  compareMergeBaseSha?: string;
  compareResponse?: unknown;
  compareHttpStatus?: number;
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function tagFetch(
  targetSha = pushedCommitSha,
  tagVerified = true,
  commitVerified = true,
  options: MainProvenanceOptions = {},
) {
  const mainProtected = options.mainProtected ?? true;
  const mainSha = options.mainSha ?? targetSha;
  const compareStatus = options.compareStatus ?? (mainSha === targetSha ? 'identical' : 'ahead');
  const compareBaseSha = options.compareBaseSha ?? targetSha;
  const compareMergeBaseSha = options.compareMergeBaseSha ?? targetSha;
  const compareResponse = options.compareResponse ?? {
    status: compareStatus,
    base_commit: { sha: compareBaseSha },
    merge_base_commit: { sha: compareMergeBaseSha },
  };
  const compareResponseStatus = options.compareHttpStatus ?? 200;
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
      new Response(JSON.stringify(compareResponse), { status: compareResponseStatus }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        name: 'main',
        protected: options.mainAfterProtected ?? mainProtected,
        commit: { sha: options.mainAfterSha ?? mainSha },
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }));
}

function verifyTag(fetchImpl: typeof fetch, expectedCommitSha = pushedCommitSha, tag = 'v1.29.3') {
  return verifyRemoteTag({
    owner: 'qnbs',
    repo: 'WorldScript-Studio',
    tag,
    expectedCommitSha,
    fetchImpl,
  });
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

  it.each([
    { name: 'identical protected main', options: { mainSha: pushedCommitSha } },
    {
      name: 'ahead protected main with the release commit as merge base',
      options: { mainSha: newerMainSha },
    },
  ])('accepts a verified tag on $name', async ({ options }) => {
    const fetchImpl = tagFetch(pushedCommitSha, true, true, options);
    const result = await verifyTag(fetchImpl);

    expect(result.ok).toBe(true);
    expect(result.verifiedTagSha).toBe(pushedCommitSha);
    expect(fetchImpl.mock.calls[4]?.[0]).toBe(
      `https://api.github.com/repos/qnbs/WorldScript-Studio/compare/${pushedCommitSha}...${options.mainSha ?? pushedCommitSha}`,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it('rejects a tag retargeted to a different commit before checking that commit', async () => {
    const fetchImpl = tagFetch(retargetedCommitSha);
    const result = await verifyTag(fetchImpl);

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

    await expect(verifyTag(fetchImpl)).rejects.toThrow(/tag name does not match the pushed ref/);
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
          merge_base_commit: { sha: pushedCommitSha },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ name: 'main', protected: true, commit: { sha: pushedCommitSha } }),
      )
      .mockResolvedValueOnce(jsonResponse({ object: { sha: changedTagObjectSha, type: 'tag' } }));

    await expect(verifyTag(fetchImpl)).rejects.toThrow(/changed during signature verification/);
  });

  it.each([
    {
      name: 'comparison marked behind',
      options: { mainSha: newerMainSha, compareStatus: 'behind' },
      error: /not contained in protected main/,
    },
    {
      name: 'comparison marked diverged',
      options: { mainSha: newerMainSha, compareStatus: 'diverged' },
      error: /not contained in protected main/,
    },
    {
      name: 'comparison with a different merge base',
      options: { mainSha: newerMainSha, compareMergeBaseSha: unrelatedMergeBaseSha },
      error: /not contained in protected main/,
    },
    {
      name: 'comparison with a different requested base',
      options: { compareBaseSha: unrelatedMergeBaseSha },
      error: /not contained in protected main/,
    },
    {
      name: 'comparison response without a merge base',
      options: {
        mainSha: newerMainSha,
        compareResponse: { status: 'ahead', base_commit: { sha: pushedCommitSha } },
      },
      error: /not contained in protected main/,
    },
    {
      name: 'comparison API failure',
      options: { mainSha: newerMainSha, compareHttpStatus: 503 },
      error: /GitHub API request failed \(503\)/,
    },
    {
      name: 'unprotected main',
      options: { mainProtected: false },
      error: /protected main branch identity/,
    },
  ])('rejects $name', async ({ options, error }) => {
    const fetchImpl = tagFetch(pushedCommitSha, true, true, options);

    await expect(verifyTag(fetchImpl)).rejects.toThrow(error);
  });

  it.each([
    { name: 'main moved during comparison', options: { mainAfterSha: unrelatedMergeBaseSha } },
    { name: 'main lost protection during comparison', options: { mainAfterProtected: false } },
  ])('rejects when $name', async ({ options }) => {
    const fetchImpl = tagFetch(pushedCommitSha, true, true, {
      mainSha: newerMainSha,
      ...options,
    });

    await expect(verifyTag(fetchImpl)).rejects.toThrow(/protected main changed/);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('rejects a missing expected SHA before resolving a mutable tag ref', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(verifyTag(fetchImpl, '')).rejects.toThrow(/expected tag target/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects lightweight tags even when the ref points to the pushed commit', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: pushedCommitSha, type: 'commit' } }));
    const result = await verifyTag(fetchImpl);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not an annotated tag/);
  });

  it.each([
    ['an unsigned annotated tag', false, true],
    ['an unsigned target commit', true, false],
  ])('rejects %s', async (_label, tagVerified, commitVerified) => {
    const result = await verifyTag(tagFetch(pushedCommitSha, tagVerified, commitVerified));

    expect(result.ok).toBe(false);
    expect(result.reports.some((report) => !report.verified)).toBe(true);
  });

  it('fails closed when the tag is missing or was deleted before lookup', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));
    await expect(verifyTag(fetchImpl)).rejects.toThrow(/GitHub API request failed \(404\)/);
  });
});
