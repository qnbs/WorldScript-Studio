import { describe, expect, it, vi } from 'vitest';
import {
  expectedTagCommitSha,
  refPatternMatches,
  verifyRemoteTag,
} from '../../../scripts/signing/verify-remote.mjs';

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
  rulesets?: TestRuleset[];
  rulesetListHttpStatus?: number;
  rulesetResponses?: Response[];
};

type TestRuleset = {
  id: number;
  rules: string[];
  target?: string;
  enforcement?: string;
  source_type?: string;
  include?: string[];
  exclude?: string[];
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

// The two repository tag rulesets as configured in production: creation is restricted, tags are immutable.
const productionRulesets: TestRuleset[] = [
  { id: 26812638, rules: ['creation', 'non_fast_forward'] },
  { id: 26812769, rules: ['update', 'deletion', 'non_fast_forward'] },
];

// The verifier reads the list and then one detail per active repository tag ruleset, in list order.
function rulesetResponses(
  rulesets: TestRuleset[] = productionRulesets,
  listStatus = 200,
): Response[] {
  if (listStatus !== 200) return [new Response('unavailable', { status: listStatus })];
  const withDefaults = rulesets.map((ruleset) => ({
    target: 'tag',
    enforcement: 'active',
    source_type: 'Repository',
    include: ['refs/tags/v*'],
    exclude: [],
    ...ruleset,
  }));
  const summaries = withDefaults.map(({ id, target, enforcement, source_type }) => ({
    id,
    name: `ruleset-${id}`,
    target,
    enforcement,
    source_type,
  }));
  const details = withDefaults
    .filter(
      ({ target, enforcement, source_type }) =>
        target === 'tag' && enforcement === 'active' && source_type === 'Repository',
    )
    .map(({ id, target, enforcement, include, exclude, rules }) =>
      jsonResponse({
        id,
        target,
        enforcement,
        conditions: { ref_name: { include, exclude } },
        rules: rules.map((type) => ({ type })),
      }),
    );
  return [jsonResponse(summaries), ...details];
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
  const responses = [
    jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }),
    jsonResponse({
      tag: 'v1.29.3',
      object: { sha: targetSha, type: 'commit' },
      verification: { verified: tagVerified, reason: tagVerified ? 'valid' : 'unsigned' },
    }),
    jsonResponse({
      sha: targetSha,
      commit: {
        message: 'release',
        verification: { verified: commitVerified, reason: commitVerified ? 'valid' : 'unsigned' },
      },
    }),
    jsonResponse({ name: 'main', protected: mainProtected, commit: { sha: mainSha } }),
    new Response(JSON.stringify(compareResponse), { status: compareResponseStatus }),
    jsonResponse({
      name: 'main',
      protected: options.mainAfterProtected ?? mainProtected,
      commit: { sha: options.mainAfterSha ?? mainSha },
    }),
    ...(options.rulesetResponses ??
      rulesetResponses(options.rulesets, options.rulesetListHttpStatus)),
    jsonResponse({ object: { sha: tagObjectSha, type: 'tag' } }),
  ];
  const fetchImpl = vi.fn<typeof fetch>();
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
  return fetchImpl;
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
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(fetchImpl.mock.calls[6]?.[0]).toBe(
      'https://api.github.com/repos/qnbs/WorldScript-Studio/rulesets?targets=tag&includes_parents=true&per_page=100',
    );
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
      );
    for (const response of rulesetResponses()) fetchImpl.mockResolvedValueOnce(response);
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ object: { sha: changedTagObjectSha, type: 'tag' } }),
    );

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

  it('accepts protection that is split across several active tag rulesets', async () => {
    const fetchImpl = tagFetch(pushedCommitSha, true, true, {
      rulesets: [
        { id: 1, rules: ['creation'], include: ['refs/tags/v*'] },
        { id: 2, rules: ['update', 'deletion'], include: ['refs/tags/*'] },
        { id: 3, rules: ['non_fast_forward'], include: ['~ALL'] },
      ],
    });
    const result = await verifyTag(fetchImpl);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });

  // QNBS-v3: github.ref_protected is unreliable for tags, so the ruleset coverage itself must fail closed on every gap.
  it.each([
    {
      name: 'no tag ruleset at all',
      rulesets: [],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a ruleset that only restricts creation',
      rulesets: [{ id: 1, rules: ['creation', 'non_fast_forward'] }],
      error: /for: update, deletion$/,
    },
    {
      name: 'a ruleset that does not restrict creation',
      rulesets: [{ id: 1, rules: ['update', 'deletion', 'non_fast_forward'] }],
      error: /for: creation$/,
    },
    {
      name: 'a ruleset that is only evaluated, not enforced',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          enforcement: 'evaluate',
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a disabled ruleset',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          enforcement: 'disabled',
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a branch ruleset with the same rules',
      rulesets: [
        { id: 1, rules: ['creation', 'update', 'deletion', 'non_fast_forward'], target: 'branch' },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'an inherited ruleset whose rules cannot be read',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          source_type: 'Organization',
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a ruleset for another tag pattern',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          include: ['refs/tags/release-*'],
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a ruleset that excludes this tag',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          exclude: ['refs/tags/v1.29.*'],
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a ruleset whose exclude syntax is unknown',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          exclude: ['refs/tags/v1.29.[0-9]'],
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a ruleset that includes the tag only through a double-star pattern',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          include: ['refs/tags/**'],
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a ruleset that excludes the tag through a double-star pattern',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          exclude: ['refs/tags/**/v*'],
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
    {
      name: 'a ruleset whose include syntax is unknown',
      rulesets: [
        {
          id: 1,
          rules: ['creation', 'update', 'deletion', 'non_fast_forward'],
          include: ['refs/tags/v{1,2}*'],
        },
      ],
      error: /for: creation, update, deletion, non_fast_forward/,
    },
  ])('rejects $name', async ({ rulesets, error }) => {
    const fetchImpl = tagFetch(pushedCommitSha, true, true, { rulesets });

    await expect(verifyTag(fetchImpl)).rejects.toThrow(error);
  });

  it('rejects when the ruleset list is unavailable or possibly truncated', async () => {
    await expect(
      verifyTag(tagFetch(pushedCommitSha, true, true, { rulesetListHttpStatus: 503 })),
    ).rejects.toThrow(/GitHub API request failed \(503\)/);

    const truncated = Array.from({ length: 100 }, (_, id) => ({ id: id + 1, rules: ['creation'] }));
    const fetchImpl = tagFetch(pushedCommitSha, true, true, {
      rulesetResponses: [jsonResponse(truncated)],
    });

    await expect(verifyTag(fetchImpl)).rejects.toThrow(/could not be read completely/);
  });

  it.each([
    ['~ALL', 'refs/tags/v1.29.3', true],
    ['refs/tags/v*', 'refs/tags/v1.29.3', true],
    ['refs/tags/v*', 'refs/tags/x1.29.3', false],
    ['refs/tags/v*', 'refs/tags/v', true],
    ['refs/tags/*1', 'refs/tags/v1', true],
    ['refs/tags/*1', 'refs/tags/v12', false],
    ['refs/tags/v*.3', 'refs/tags/v1.29.3', true],
    ['refs/tags/v*.3', 'refs/tags/v1/2.3', false],
    ['refs/tags/v?.0', 'refs/tags/v1.0', true],
    ['refs/tags/v?.0', 'refs/tags/v/.0', false],
    ['refs/tags/v1.29.3', 'refs/tags/v1.29.3', true],
    ['refs/tags/v1.29.3', 'refs/tags/v1.29.31', false],
    ['refs/tags/v*', 'refs/heads/v1', false],
    ['refs/tags/v*', 'refs/tags/v1/evil', false],
    ['refs/tags/**', 'refs/tags/v1/evil', null],
    ['refs/tags/**', 'refs/tags/v1', null],
    ['refs/tags/**/v*', 'refs/tags/v1', null],
    ['refs/tags/*', 'refs/tags/v1.29.3', true],
    ['refs/tags/v1.29.?', 'refs/tags/v1.29.3', true],
    ['refs/tags/v1.29.3', 'refs/tags/v1x29x3', false],
    ['refs/tags/v1.29.[0-9]', 'refs/tags/v1.29.3', null],
    ['refs/tags/v{1,2}', 'refs/tags/v1', null],
    ['', 'refs/tags/v1', null],
    [undefined, 'refs/tags/v1', null],
  ])('matches ruleset pattern %s against %s as %s', (pattern, ref, expected) => {
    expect(refPatternMatches(pattern, ref)).toBe(expected);
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
