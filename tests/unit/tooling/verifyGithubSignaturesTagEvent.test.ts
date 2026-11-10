import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// End-to-end reproduction of the v1.29.3 tag-run failure ("push event target does not match github.sha"):
// the real gate script runs as a child process against a model of the GitHub API and a tag push event.
// The SHAs are the real ones of that release: the annotated tag object differs from the commit it points to.
// The event fixture models only the documented push-event fields that the gate reads (ref, before, after).
const SCRIPT = resolve('scripts/signing/verify-github-signatures.mjs');
const PRELOAD = pathToFileURL(resolve('tests/unit/tooling/support/githubApiMock.mjs')).href;
const TAG = 'v1.29.3';
const TAG_OBJECT = 'b9ec53dc53feea11c8c942769c77d62873b60c93';
const COMMIT = '62ad48d3b76e32084267782eeac3801906302321';
const OTHER_COMMIT = '1111111111111111111111111111111111111111';
const OTHER_OBJECT = '2222222222222222222222222222222222222222';
const ZERO = '0'.repeat(40);
const PROTECTION = [
  { id: 26812638, rules: ['creation', 'non_fast_forward'] },
  { id: 26812769, rules: ['update', 'deletion', 'non_fast_forward'] },
];

type Options = {
  event?: Record<string, unknown>;
  githubSha?: string;
  refName?: string;
  refObject?: { sha: string; type: string };
  tagTarget?: string;
  tagVerified?: boolean;
  commitVerified?: boolean;
  rulesets?: typeof PROTECTION;
};

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runGate(options: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tag-gate-'));
  scratch.push(dir);
  const scenario = {
    owner: 'qnbs',
    repo: 'WorldScript-Studio',
    tag: TAG,
    refObject: options.refObject ?? { sha: TAG_OBJECT, type: 'tag' },
    tagObject: {
      sha: options.refObject?.sha ?? TAG_OBJECT,
      name: TAG,
      targetSha: options.tagTarget ?? COMMIT,
      verified: options.tagVerified ?? true,
    },
    commit: { sha: options.tagTarget ?? COMMIT, verified: options.commitVerified ?? true },
    mainSha: COMMIT,
    rulesets: options.rulesets ?? PROTECTION,
  };
  const scenarioPath = join(dir, 'scenario.json');
  const eventPath = join(dir, 'event.json');
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  writeFileSync(
    eventPath,
    JSON.stringify(
      options.event ?? { ref: `refs/tags/${TAG}`, before: ZERO, after: TAG_OBJECT, created: true },
    ),
  );
  return spawnSync(
    process.execPath,
    ['--import', `${PRELOAD}?scenario=${encodeURIComponent(scenarioPath)}`, SCRIPT],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'] ?? '',
        GITHUB_REPOSITORY: 'qnbs/WorldScript-Studio',
        GITHUB_TOKEN: 'test-token',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_REF_NAME: options.refName ?? TAG,
        GITHUB_SHA: options.githubSha ?? COMMIT,
        GITHUB_EVENT_PATH: eventPath,
      },
    },
  );
}

describe('release tag gate with a real-shaped annotated tag push event', () => {
  it('accepts a signed annotated tag whose push event announces the tag object', () => {
    const result = runGate();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('b9ec53dc53fe verified valid tag v1.29.3');
    expect(result.stdout).toContain('62ad48d3b76e verified valid release');
  });

  it('rejects an event that announces the peeled commit instead of the tag object', () => {
    const result = runGate({ event: { ref: `refs/tags/${TAG}`, before: ZERO, after: COMMIT } });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not match the live release tag object/);
    expect(result.stderr).toContain(`event ${COMMIT}`);
    expect(result.stderr).toContain(`tag ${TAG_OBJECT}`);
  });

  it('rejects a lightweight tag even when the event, github.sha and the ref all name the commit', () => {
    const result = runGate({
      event: { ref: `refs/tags/${TAG}`, before: ZERO, after: COMMIT },
      refObject: { sha: COMMIT, type: 'commit' },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('release tag is not an annotated tag object');
  });

  it('rejects an annotated tag that points at a different commit than github.sha', () => {
    const result = runGate({ tagTarget: OTHER_COMMIT });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/does not match the pushed event commit/);
  });

  it.each([
    [
      'an event without an after value',
      { ref: `refs/tags/${TAG}`, before: ZERO },
      /full pushed tag object/,
    ],
    [
      'a deleted-ref after value',
      { ref: `refs/tags/${TAG}`, before: TAG_OBJECT, after: ZERO },
      /live pushed tag object/,
    ],
    [
      'a malformed after value',
      { ref: `refs/tags/${TAG}`, after: 'not-a-sha' },
      /full pushed tag object/,
    ],
    [
      'a different tag object than the live ref',
      { ref: `refs/tags/${TAG}`, after: OTHER_OBJECT },
      /does not match the live release tag object/,
    ],
    [
      'an event for another ref',
      { ref: 'refs/tags/v9.9.9', after: TAG_OBJECT },
      /push event ref does not match/,
    ],
    [
      'an event for a branch ref',
      { ref: 'refs/heads/main', after: TAG_OBJECT },
      /push event ref does not match/,
    ],
  ])('rejects %s', (_name, event, error) => {
    const result = runGate({ event });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(error);
  });

  it('rejects a github.sha that is not a full commit SHA', () => {
    const result = runGate({ githubSha: 'abc123' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/GitHub context does not contain a full commit SHA/);
  });

  it.each([
    ['an unsigned annotated tag', { tagVerified: false }],
    ['an unsigned target commit', { commitVerified: false }],
  ])('rejects %s', (_name, options) => {
    const result = runGate(options);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('REJECTED unsigned');
  });

  it('rejects a tag that is not covered by active tag rulesets', () => {
    const result = runGate({ rulesets: [] });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not covered by active tag rulesets for: creation, update/);
  });

  it('rejects a tag name that is not a version tag', () => {
    const result = runGate({
      refName: 'nightly',
      event: { ref: 'refs/tags/nightly', after: TAG_OBJECT },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/push event ref does not match the requested version tag/);
  });
});
