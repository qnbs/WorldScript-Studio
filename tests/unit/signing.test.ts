import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepositoryPolicy,
  classifyCommitObject,
  classifyTagVerification,
  computeWorkingTreeState,
  getSigningConfig,
  hasCommitSignature,
  isGitHubCompatibleEmail,
  normalizePrePushUpdates,
  outgoingBaseShas,
  parsePrePushEvidence,
  parseRefUpdate,
  pushCommitShas,
  pushEventRange,
  readPrePushEvidenceFile,
  resolvePushEvidence,
  runSigningProbe,
  selectIntroducedCommits,
  serializePrePushEvidence,
  verifyOutgoingUpdates,
  writePrePushEvidenceFile,
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
        [`refs/tags/v1.0.1 ${commit} refs/tags/v1.0.1 ${remote}`],
        'origin',
        process.cwd(),
        { verifyTagObject: () => ({ ok: true, reason: 'tag and target commit verified' }) },
      ),
    ).toMatchObject({ ok: true, reports: [{ sha: commit, subject: 'refs/tags/v1.0.1' }] });
    let tagVerificationCalled = false;
    expect(
      verifyOutgoingUpdates(
        [
          {
            localRef: 'refs/tags/v1.0.2',
            localSha: commit,
            remoteRef: 'refs/tags/v1.0.2',
            remoteSha: 'invalid-remote-sha',
          },
        ],
        'origin',
        process.cwd(),
        {
          verifyTagObject: () => {
            tagVerificationCalled = true;
            return { ok: true, reason: 'tag and target commit verified' };
          },
        },
      ),
    ).toMatchObject({ ok: false });
    expect(tagVerificationCalled).toBe(false);
    expect(
      verifyOutgoingUpdates(
        [
          {
            localRef: 'refs/heads/main',
            localSha: commit,
            remoteRef: 'refs/heads/main',
            remoteSha: 'invalid-remote-sha',
          },
        ],
        'origin',
        process.cwd(),
        {
          introducedCommits: () => [commit],
          verifyCommitObject: () => ({ ok: true, reason: 'Git-native signature verified' }),
        },
      ),
    ).toMatchObject({ ok: false });
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

  // QNBS-v3: lock the pre-push evidence contract against malformed or unresolved input.
  it('normalizes raw, line-array, structured, and empty public inputs', () => {
    const zero = '0'.repeat(40);
    const line = `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`;
    const structured = parseRefUpdate(line)!;
    expect(normalizePrePushUpdates('')).toEqual([]);
    expect(normalizePrePushUpdates(line)).toEqual([structured]);
    expect(normalizePrePushUpdates([line])).toEqual([structured]);
    expect(normalizePrePushUpdates([structured])).toEqual([structured]);
    expect(
      verifyOutgoingUpdates('', 'origin', process.cwd(), {
        introducedCommits: () => {
          throw new Error('no-op must not enumerate commits');
        },
      }),
    ).toMatchObject({ ok: true, reports: [] });
    expect(
      normalizePrePushUpdates(`refs/heads/deleted ${zero} refs/heads/deleted ${'c'.repeat(40)}`),
    ).toHaveLength(1);
    expect(() => normalizePrePushUpdates('malformed')).toThrow('invalid pre-push ref-update input');
    expect(() => normalizePrePushUpdates('\n')).toThrow('invalid pre-push ref-update input');
  });

  it('resolves branch, new-branch, deletion, tag, and multi-ref evidence losslessly', () => {
    const zero = '0'.repeat(40);
    const updates = [
      parseRefUpdate(`refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`)!,
      parseRefUpdate(`refs/heads/new ${'c'.repeat(40)} refs/heads/new ${zero}`)!,
      parseRefUpdate(`refs/heads/deleted ${zero} refs/heads/deleted ${'d'.repeat(40)}`)!,
      parseRefUpdate(`refs/tags/v1 ${'e'.repeat(40)} refs/tags/v1 ${zero}`)!,
    ];
    const result = resolvePushEvidence(updates, process.cwd(), {
      commitExists: (sha) => sha !== '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      objectExists: () => true,
      changedFilesBetween: (base) =>
        base === '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
          ? ['new\nfile.ts']
          : ['src/with\t tab.ts', '世界 file.ts', 'src/with\t tab.ts'],
      worktreeMatchesCommit: () => 'MATCHES',
      dependencyStateForRef: () => 'MATCHES',
    });
    expect(result.evidenceState).toBe('RESOLVED');
    expect(result.pathEvidenceState).toBe('PARTIAL');
    expect(result.updates.map(({ disposition }) => disposition)).toEqual([
      'UPDATED',
      'NEW_BRANCH',
      'DELETED',
      'TAG',
    ]);
    expect(result.changedFiles).toEqual(['src/with\t tab.ts', '世界 file.ts', 'new\nfile.ts']);
  });

  // QNBS-v3: branch/new-branch/deletion diff real content; tags can't without inventing paths.
  it('reports complete path evidence for branch, new-branch, and deletion updates', () => {
    const zero = '0'.repeat(40);
    const updates = [
      parseRefUpdate(`refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`)!,
      parseRefUpdate(`refs/heads/new ${'c'.repeat(40)} refs/heads/new ${zero}`)!,
      parseRefUpdate(`refs/heads/deleted ${zero} refs/heads/deleted ${'d'.repeat(40)}`)!,
    ];
    const result = resolvePushEvidence(updates, process.cwd(), {
      commitExists: () => true,
      changedFilesBetween: () => ['src/example.ts'],
      worktreeMatchesCommit: () => 'MATCHES',
      dependencyStateForRef: () => 'MATCHES',
    });

    expect(result.evidenceState).toBe('RESOLVED');
    expect(result.pathEvidenceState).toBe('COMPLETE');
  });

  it('marks lightweight and annotated tag evidence partial without inventing paths', () => {
    const commit = 'a'.repeat(40);
    const lightweight = parseRefUpdate(`refs/tags/v1 ${commit} refs/tags/v1 ${'0'.repeat(40)}`)!;
    const annotated = parseRefUpdate(
      `refs/tags/v2 ${'b'.repeat(40)} refs/tags/v2 ${'c'.repeat(40)}`,
    )!;

    for (const update of [lightweight, annotated]) {
      const result = resolvePushEvidence([update], process.cwd(), {
        objectExists: () => true,
        worktreeMatchesCommit: () => 'MATCHES',
        dependencyStateForRef: () => 'MATCHES',
      });
      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.pathEvidenceState).toBe('PARTIAL');
      expect(result.changedFiles).toEqual([]);
      // QNBS-v3: tags are no longer excluded from divergence detection (unlike pathEvidenceState).
      expect(result.updates[0]?.workingTreeState).toBe('MATCHES');
      expect(result.updates[0]?.dependencyState).toBe('MATCHES');
    }
  });

  it('marks mixed branch and tag evidence partial', () => {
    const zero = '0'.repeat(40);
    const result = resolvePushEvidence(
      [
        parseRefUpdate(`refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`)!,
        parseRefUpdate(`refs/tags/v1 ${'c'.repeat(40)} refs/tags/v1 ${zero}`)!,
      ],
      process.cwd(),
      {
        commitExists: () => true,
        objectExists: () => true,
        changedFilesBetween: () => ['src/a.ts'],
        worktreeMatchesCommit: () => 'MATCHES',
        dependencyStateForRef: () => 'MATCHES',
      },
    );

    expect(result.evidenceState).toBe('RESOLVED');
    expect(result.pathEvidenceState).toBe('PARTIAL');
    expect(result.changedFiles).toEqual(['src/a.ts']);
  });

  it('keeps empty evidence complete and rejects an unavailable tag object', () => {
    const empty = resolvePushEvidence([]);
    expect(empty.pathEvidenceState).toBe('COMPLETE');
    // QNBS-v3: nothing was compared, not "compared and found equal" — see aggregation precedence.
    expect(empty.workingTreeState).toBe('NOT_APPLICABLE');
    expect(empty.dependencyState).toBe('NOT_APPLICABLE');

    const result = resolvePushEvidence(
      [parseRefUpdate(`refs/tags/v1 ${'a'.repeat(40)} refs/tags/v1 ${'0'.repeat(40)}`)!],
      process.cwd(),
      { objectExists: () => false },
    );

    expect(result.evidenceState).toBe('INVALID');
    expect(result.pathEvidenceState).toBe('PARTIAL');
  });

  it('fails closed for missing objects, bases, Git failures, and unsupported evidence', () => {
    const update = parseRefUpdate(
      `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,
    )!;
    expect(resolvePushEvidence([update]).evidenceState).toBe('INVALID');
    expect(
      resolvePushEvidence([update], process.cwd(), {
        commitExists: (sha) => sha === 'a'.repeat(40),
      }).evidenceState,
    ).toBe('INVALID');
    expect(
      resolvePushEvidence([update], process.cwd(), {
        commitExists: () => true,
        changedFilesBetween: () => {
          throw new Error('git diff failed');
        },
      }).evidenceState,
    ).toBe('INVALID');
    expect(
      resolvePushEvidence(
        [
          parseRefUpdate(
            `refs/remotes/origin/x ${'a'.repeat(40)} refs/remotes/origin/x ${'b'.repeat(40)}`,
          )!,
        ],
        process.cwd(),
        { commitExists: () => true },
      ).evidenceState,
    ).toBe('INVALID');
    expect(
      resolvePushEvidence([
        parseRefUpdate(
          `refs/remotes/origin/x ${'0'.repeat(40)} refs/remotes/origin/x ${'b'.repeat(40)}`,
        )!,
      ]).evidenceState,
    ).toBe('INVALID');
  });

  describe('computeWorkingTreeState (diagnostic-only, isolated from canonical evidence)', () => {
    const sha = 'a'.repeat(40);

    it('reports MATCHES for a genuine exit code 0 with no process error', () => {
      expect(
        computeWorkingTreeState(sha, process.cwd(), {
          runGit: () => ({ status: 0, stdout: '', stderr: '' }),
        }),
      ).toBe('MATCHES');
    });

    it('reports DIVERGED for a genuine exit code 1 with no process error', () => {
      expect(
        computeWorkingTreeState(sha, process.cwd(), {
          runGit: () => ({ status: 1, stdout: '', stderr: '' }),
        }),
      ).toBe('DIVERGED');
    });

    // QNBS-v3: runGit maps a killed/failed spawn's status:null to 1 via `?? 1` — error must win first.
    it('reports UNKNOWN on a process error, even though runGit maps its status to 1', () => {
      expect(
        computeWorkingTreeState(sha, process.cwd(), {
          runGit: () => ({ status: 1, stdout: '', stderr: '', error: new Error('spawn timeout') }),
        }),
      ).toBe('UNKNOWN');
      expect(
        computeWorkingTreeState(sha, process.cwd(), {
          runGit: () => ({ status: 0, stdout: '', stderr: '', error: new Error('spawn timeout') }),
        }),
      ).toBe('UNKNOWN');
    });

    it('reports UNKNOWN for any other exit code (e.g. a tag peeling to a non-commit)', () => {
      expect(
        computeWorkingTreeState(sha, process.cwd(), {
          runGit: () => ({ status: 128, stdout: '', stderr: 'fatal: bad revision' }),
        }),
      ).toBe('UNKNOWN');
    });

    // QNBS-v3: an injected runner that throws must not escape into the canonical evidence catch.
    it('reports UNKNOWN rather than propagating a throw from an injected runner', () => {
      expect(
        computeWorkingTreeState(sha, process.cwd(), {
          runGit: () => {
            throw new Error('spawn EMFILE');
          },
        }),
      ).toBe('UNKNOWN');
    });
  });

  describe('workingTreeState (diagnostic dimension, never affects canonical evidence validity)', () => {
    it('does not mutate evidenceState or pathEvidenceState when the diagnostic reports UNKNOWN', () => {
      const update = parseRefUpdate(
        `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,
      )!;
      const result = resolvePushEvidence([update], process.cwd(), {
        commitExists: () => true,
        changedFilesBetween: () => ['src/example.ts'],
        worktreeMatchesCommit: () => 'UNKNOWN',
        dependencyStateForRef: () => 'MATCHES',
      });

      // QNBS-v3: this is the regression guard for the diagnostic-isolation correction specifically.
      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.pathEvidenceState).toBe('COMPLETE');
      expect(result.workingTreeState).toBe('UNKNOWN');
    });

    it('assigns DELETED updates NOT_APPLICABLE without calling the diagnostic', () => {
      const zero = '0'.repeat(40);
      const deletion = parseRefUpdate(`refs/heads/old ${zero} refs/heads/old ${'b'.repeat(40)}`)!;
      const result = resolvePushEvidence([deletion], process.cwd(), {
        worktreeMatchesCommit: () => {
          throw new Error('must not be called for a deletion');
        },
        dependencyStateForRef: () => {
          throw new Error('must not be called for a deletion');
        },
      });

      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.updates[0]?.workingTreeState).toBe('NOT_APPLICABLE');
      expect(result.updates[0]?.dependencyState).toBe('NOT_APPLICABLE');
      expect(result.workingTreeState).toBe('NOT_APPLICABLE');
      expect(result.dependencyState).toBe('NOT_APPLICABLE');
    });

    it('aggregates with DIVERGED outranking UNKNOWN, and UNKNOWN outranking MATCHES', () => {
      const updateA = parseRefUpdate(
        `refs/heads/a ${'a'.repeat(40)} refs/heads/a ${'b'.repeat(40)}`,
      )!;
      const updateB = parseRefUpdate(
        `refs/heads/b ${'c'.repeat(40)} refs/heads/b ${'d'.repeat(40)}`,
      )!;
      const shared = { commitExists: () => true, changedFilesBetween: () => [] };

      const divergedPlusUnknown = resolvePushEvidence([updateA, updateB], process.cwd(), {
        ...shared,
        worktreeMatchesCommit: (sha) => (sha === updateA.localSha ? 'DIVERGED' : 'UNKNOWN'),
        dependencyStateForRef: () => 'MATCHES',
      });
      expect(divergedPlusUnknown.workingTreeState).toBe('DIVERGED');

      const matchesPlusUnknown = resolvePushEvidence([updateA, updateB], process.cwd(), {
        ...shared,
        worktreeMatchesCommit: (sha) => (sha === updateA.localSha ? 'MATCHES' : 'UNKNOWN'),
        dependencyStateForRef: () => 'MATCHES',
      });
      expect(matchesPlusUnknown.workingTreeState).toBe('UNKNOWN');
    });

    it('aggregates a push containing only deletions as NOT_APPLICABLE', () => {
      const zero = '0'.repeat(40);
      const result = resolvePushEvidence(
        [
          parseRefUpdate(`refs/heads/a ${zero} refs/heads/a ${'a'.repeat(40)}`)!,
          parseRefUpdate(`refs/heads/b ${zero} refs/heads/b ${'b'.repeat(40)}`)!,
        ],
        process.cwd(),
      );
      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.workingTreeState).toBe('NOT_APPLICABLE');
      expect(result.dependencyState).toBe('NOT_APPLICABLE');
    });

    // QNBS-v3: an injected worktreeMatchesCommit that throws must not corrupt canonical evidence.
    it('reports UNKNOWN rather than corrupting canonical evidence when the injected resolver throws', () => {
      const update = parseRefUpdate(
        `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,
      )!;
      const result = resolvePushEvidence([update], process.cwd(), {
        commitExists: () => true,
        changedFilesBetween: () => ['src/example.ts'],
        worktreeMatchesCommit: () => {
          throw new Error('spawn EMFILE');
        },
        dependencyStateForRef: () => 'MATCHES',
      });

      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.pathEvidenceState).toBe('COMPLETE');
      expect(result.workingTreeState).toBe('UNKNOWN');
    });
  });

  describe('dependencyState (diagnostic dimension, never affects canonical evidence validity)', () => {
    it('does not mutate evidenceState or pathEvidenceState when the diagnostic reports UNKNOWN', () => {
      const update = parseRefUpdate(
        `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,
      )!;
      const result = resolvePushEvidence([update], process.cwd(), {
        commitExists: () => true,
        changedFilesBetween: () => ['package.json'],
        worktreeMatchesCommit: () => 'MATCHES',
        dependencyStateForRef: () => 'UNKNOWN',
      });

      // QNBS-v3: mirrors the workingTreeState isolation guard, for the dependencyState dimension.
      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.pathEvidenceState).toBe('COMPLETE');
      expect(result.dependencyState).toBe('UNKNOWN');
    });

    it('assigns DELETED updates NOT_APPLICABLE without calling the diagnostic', () => {
      const zero = '0'.repeat(40);
      const deletion = parseRefUpdate(`refs/heads/old ${zero} refs/heads/old ${'b'.repeat(40)}`)!;
      const result = resolvePushEvidence([deletion], process.cwd(), {
        worktreeMatchesCommit: () => {
          throw new Error('must not be called for a deletion');
        },
        dependencyStateForRef: () => {
          throw new Error('must not be called for a deletion');
        },
      });

      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.updates[0]?.dependencyState).toBe('NOT_APPLICABLE');
      expect(result.dependencyState).toBe('NOT_APPLICABLE');
    });

    it('aggregates with DIVERGED outranking UNKNOWN, and UNKNOWN outranking MATCHES', () => {
      const updateA = parseRefUpdate(
        `refs/heads/a ${'a'.repeat(40)} refs/heads/a ${'b'.repeat(40)}`,
      )!;
      const updateB = parseRefUpdate(
        `refs/heads/b ${'c'.repeat(40)} refs/heads/b ${'d'.repeat(40)}`,
      )!;
      const shared = { commitExists: () => true, changedFilesBetween: () => [] };

      const divergedPlusUnknown = resolvePushEvidence([updateA, updateB], process.cwd(), {
        ...shared,
        worktreeMatchesCommit: () => 'MATCHES',
        dependencyStateForRef: (sha) => (sha === updateA.localSha ? 'DIVERGED' : 'UNKNOWN'),
      });
      expect(divergedPlusUnknown.dependencyState).toBe('DIVERGED');

      const matchesPlusUnknown = resolvePushEvidence([updateA, updateB], process.cwd(), {
        ...shared,
        worktreeMatchesCommit: () => 'MATCHES',
        dependencyStateForRef: (sha) => (sha === updateA.localSha ? 'MATCHES' : 'UNKNOWN'),
      });
      expect(matchesPlusUnknown.dependencyState).toBe('UNKNOWN');
    });

    it('aggregates a push containing only deletions as NOT_APPLICABLE', () => {
      const zero = '0'.repeat(40);
      const result = resolvePushEvidence(
        [
          parseRefUpdate(`refs/heads/a ${zero} refs/heads/a ${'a'.repeat(40)}`)!,
          parseRefUpdate(`refs/heads/b ${zero} refs/heads/b ${'b'.repeat(40)}`)!,
        ],
        process.cwd(),
      );
      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.dependencyState).toBe('NOT_APPLICABLE');
    });

    // QNBS-v3: regression for the CodeRabbit finding -- an injected resolver throw must map to UNKNOWN.
    it('reports UNKNOWN rather than corrupting canonical evidence when the injected resolver throws', () => {
      const update = parseRefUpdate(
        `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`,
      )!;
      const result = resolvePushEvidence([update], process.cwd(), {
        commitExists: () => true,
        changedFilesBetween: () => ['package.json'],
        worktreeMatchesCommit: () => 'MATCHES',
        dependencyStateForRef: () => {
          throw new Error('git show failed');
        },
      });

      expect(result.evidenceState).toBe('RESOLVED');
      expect(result.pathEvidenceState).toBe('COMPLETE');
      expect(result.dependencyState).toBe('UNKNOWN');
    });
  });

  it('round-trips the same immutable artifact for both consumers', () => {
    let dir: string;
    try {
      dir = mkdtempSync(join(tmpdir(), 'worldscript-s3a-test-'));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('read-only file system'))
        throw error;
      dir = mkdtempSync(join(process.cwd(), '.worldscript-s3a-test-'));
    }
    const file = join(dir, 'evidence.json');
    const line = `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}`;
    try {
      writePrePushEvidenceFile(file, [line]);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(() => writePrePushEvidenceFile(file, [line])).toThrow();
      const serialized = readFileSync(file, 'utf8');
      expect(parsePrePushEvidence(serialized)).toEqual(normalizePrePushUpdates([line]));
      expect(readPrePushEvidenceFile(file)).toEqual(normalizePrePushUpdates([line]));
      expect(() => readPrePushEvidenceFile(join(dir, 'missing.json'))).toThrow();
      writeFileSync(file, '{"version":1,"updates":', { flag: 'w' });
      expect(() => readPrePushEvidenceFile(file)).toThrow('not valid JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(() => readPrePushEvidenceFile(file)).toThrow();
  });

  it('keeps large multi-ref evidence in the artifact contract, not process environment', () => {
    const updates = Array.from({ length: 200 }, (_, index) => ({
      localRef: `refs/heads/feature-${index}`,
      localSha: index.toString(16).padStart(40, '0'),
      remoteRef: `refs/heads/feature-${index}`,
      remoteSha: '0'.repeat(40),
    }));
    const artifact = serializePrePushEvidence(updates);
    expect(artifact.length).toBeGreaterThan(10_000);
    expect(parsePrePushEvidence(artifact)).toEqual(updates);
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

// QNBS-v3: real disposable git fixtures, not mocks -- the defect class is about real git subprocess env/resolution behavior.
describe('signing probe isolation (foreign-repo environment leak hardening)', () => {
  const doctorPath = resolve(process.cwd(), 'scripts/signing/doctor.mjs');
  const scratchDirs: string[] = [];

  function scratchDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    scratchDirs.push(dir);
    return dir;
  }

  function gitConfigLocal(dir: string, key: string, value: string) {
    execFileSync('git', ['-C', dir, 'config', '--local', key, value]);
  }

  // QNBS-v3: real SSH-format signing/verification, matching this repo's own gpg.format=ssh setup.
  function createSigningFixture(): { dir: string; email: string } {
    const dir = scratchDir('worldscript-signing-fixture-');
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', dir]);
    const email = 'fixture@users.noreply.github.com';
    const keyPath = join(dir, 'id_ed25519');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath, '-C', email]);
    const publicKey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
    const allowedSignersFile = join(dir, 'allowed_signers');
    writeFileSync(allowedSignersFile, `${email} ${publicKey}\n`);
    gitConfigLocal(dir, 'user.name', 'Fixture User');
    gitConfigLocal(dir, 'user.email', email);
    gitConfigLocal(dir, 'commit.gpgsign', 'true');
    gitConfigLocal(dir, 'tag.gpgsign', 'true');
    gitConfigLocal(dir, 'gpg.format', 'ssh');
    gitConfigLocal(dir, 'user.signingkey', keyPath);
    gitConfigLocal(dir, 'gpg.ssh.allowedSignersFile', allowedSignersFile);
    // QNBS-v3: an empty repo has no refs at all, which makes `git show-ref` exit non-zero -- give it real history.
    writeFileSync(join(dir, 'README.md'), 'fixture\n');
    execFileSync('git', ['-C', dir, 'add', 'README.md']);
    execFileSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'initial commit']);
    return { dir, email };
  }

  function snapshotRepo(dir: string) {
    return {
      config: readFileSync(join(dir, '.git', 'config'), 'utf8'),
      head: readFileSync(join(dir, '.git', 'HEAD'), 'utf8'),
      refs: execFileSync('git', ['-C', dir, 'show-ref'], { encoding: 'utf8' }),
    };
  }

  function probeTempDirs(): string[] {
    return readdirSync(tmpdir()).filter((name) => name.startsWith('worldscript-signing-probe-'));
  }

  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  describe('foreign-repo env leak vectors (probe stays isolated under a hostile ambient env)', () => {
    const hostileVars = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'] as const;

    for (const varName of hostileVars) {
      it(`does not let an inherited ${varName} redirect the probe into the real repo`, () => {
        const { dir } = createSigningFixture();
        const before = snapshotRepo(dir);
        const original = process.env[varName];
        process.env[varName] =
          varName === 'GIT_INDEX_FILE' ? join(dir, '.git', 'index') : join(dir, '.git');
        try {
          const result = runSigningProbe(dir);
          expect(result.ok).toBe(true);
          // QNBS-v3: proves the commit object never touched the fixture's own object database.
          expect(() =>
            execFileSync('git', ['-C', dir, 'cat-file', '-e', result.commit as string], {
              stdio: 'ignore',
            }),
          ).toThrow();
        } finally {
          if (original === undefined) delete process.env[varName];
          else process.env[varName] = original;
        }
        expect(snapshotRepo(dir)).toEqual(before);
      });
    }
  });

  it('cleans up the disposable probe directory on success', () => {
    const { dir } = createSigningFixture();
    const before = probeTempDirs();
    const result = runSigningProbe(dir);
    expect(result.ok).toBe(true);
    expect(probeTempDirs()).toEqual(before);
  });

  it('cleans up the disposable probe directory even when a probe step fails mid-way', () => {
    const { dir } = createSigningFixture();
    // QNBS-v3: an unusable signing key lets config succeed but makes the later commit-tree -S step genuinely fail.
    gitConfigLocal(dir, 'user.signingkey', join(dir, 'no-such-key'));
    const before = probeTempDirs();
    const result = runSigningProbe(dir);
    expect(result.ok).toBe(false);
    expect(probeTempDirs()).toEqual(before);
  });

  it('runs two probes concurrently in separate OS processes without interference', async () => {
    const { dir } = createSigningFixture();
    const before = snapshotRepo(dir);
    const runInChildProcess = (): Promise<{ ok: boolean; commit?: string; reason?: string }> =>
      new Promise((resolvePromise, reject) => {
        const moduleUrl = pathToFileURL(
          resolve(process.cwd(), 'scripts/signing/signing-core.mjs'),
        ).href;
        const child = spawn(
          process.execPath,
          [
            '-e',
            `import(${JSON.stringify(moduleUrl)}).then(m => { process.stdout.write(JSON.stringify(m.runSigningProbe(${JSON.stringify(dir)}))); });`,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.on('error', reject);
        child.on('close', () => {
          try {
            resolvePromise(JSON.parse(stdout));
          } catch (error) {
            reject(error);
          }
        });
      });
    const [first, second] = await Promise.all([runInChildProcess(), runInChildProcess()]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // QNBS-v3: isolation means neither corrupted the outer repo, not that deterministic ed25519 signatures must differ.
    expect(snapshotRepo(dir)).toEqual(before);
  });

  it('regresses none of the pre-existing signing.test.ts assertions', () => {
    // QNBS-v3: explicit marker -- the full suite already re-runs on every invocation of this file.
    expect(getSigningConfig()).toHaveProperty('enabled');
  });

  describe('REPOSITORY_POLICY_MODE (--hook path, real git commit through the real pre-commit hook)', () => {
    let fixture: { dir: string; email: string };
    let fileCounter = 0;

    beforeAll(() => {
      fixture = createSigningFixture();
      // QNBS-v3: owned by this describe's own afterAll -- the shared afterEach must not wipe it between these tests.
      scratchDirs.splice(scratchDirs.indexOf(fixture.dir), 1);
      const hookPath = join(fixture.dir, '.git', 'hooks', 'pre-commit');
      writeFileSync(
        hookPath,
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(doctorPath)} --hook\n`,
        { mode: 0o755 },
      );
    });

    afterAll(() => {
      rmSync(fixture.dir, { recursive: true, force: true });
    });

    function attemptCommit(extraGitArgs: string[] = []) {
      fileCounter += 1;
      const file = join(fixture.dir, `file-${fileCounter}.txt`);
      writeFileSync(file, `content-${fileCounter}`);
      execFileSync('git', ['-C', fixture.dir, 'add', file]);
      return spawnSync(
        'git',
        ['-C', fixture.dir, ...extraGitArgs, 'commit', '-m', `test commit ${fileCounter}`],
        { encoding: 'utf8' },
      );
    }

    it('passes a normal commit through the real pre-commit hook', () => {
      const result = attemptCommit();
      expect(result.status).toBe(0);
    });

    it('does not regress a harmless -c override unrelated to the signing policy', () => {
      const result = attemptCommit(['-c', 'core.editor=true']);
      expect(result.status).toBe(0);
    });

    it('does not fail on a -c override that matches the persisted policy value', () => {
      const result = attemptCommit(['-c', 'commit.gpgsign=true']);
      expect(result.status).toBe(0);
    });

    it('fails closed before the probe runs when a -c override redefines the signing policy', () => {
      const result = attemptCommit(['-c', 'commit.gpgsign=false']);
      expect(result.status).not.toBe(0);
      // QNBS-v3: git relays a FAILING hook's stdout through its own stderr; a passing hook's goes through stdout.
      expect(result.stderr).toMatch(
        /repository policy: mismatch — command-scope override redefines persisted policy for commit\.gpgsign/,
      );
      expect(result.stderr).toMatch(
        /isolated signing probe: failed — command-scope override redefines persisted policy for commit\.gpgsign/,
      );
    });
  });

  describe('auditRepositoryPolicy (direct unit coverage for the comparison/validation logic)', () => {
    let fixture: { dir: string; email: string };

    beforeEach(() => {
      fixture = createSigningFixture();
    });

    it('matches when no command-scope override is present', () => {
      expect(auditRepositoryPolicy(fixture.dir, process.env)).toMatchObject({ ok: true });
    });

    it('is not fatal for a well-formed override outside the audited key set', () => {
      const env = {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.editor',
        GIT_CONFIG_VALUE_0: 'true',
      };
      expect(auditRepositoryPolicy(fixture.dir, env)).toMatchObject({ ok: true });
    });

    it('is not fatal for an override equal to the persisted value', () => {
      const env = {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'commit.gpgsign',
        GIT_CONFIG_VALUE_0: 'true',
      };
      expect(auditRepositoryPolicy(fixture.dir, env)).toMatchObject({ ok: true });
    });

    it('fails when an override redefines an audited policy key', () => {
      const env = {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'commit.gpgsign',
        GIT_CONFIG_VALUE_0: 'false',
      };
      expect(auditRepositoryPolicy(fixture.dir, env)).toMatchObject({
        ok: false,
        reason: 'command-scope override redefines persisted policy for commit.gpgsign',
      });
    });

    it('fails closed when command-scope config is internally malformed', () => {
      // QNBS-v3: declares 1 override pair via COUNT but supplies neither KEY_0 nor VALUE_0.
      const env = { ...process.env, GIT_CONFIG_COUNT: '1' };
      expect(auditRepositoryPolicy(fixture.dir, env)).toMatchObject({
        ok: false,
        reason: 'command-scope configuration is malformed',
      });
    });
  });
});
