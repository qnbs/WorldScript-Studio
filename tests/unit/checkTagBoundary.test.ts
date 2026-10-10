// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as docMetrics from '../../scripts/check-doc-metrics.mjs';

type Boundary = { code: string; finding?: string };
type MetricsModule = {
  classifyReleaseTagBoundary: (options: {
    repositoryRoot: string;
    head?: string;
    context?: string;
  }) => Boundary;
  collectGovernedReleaseFindings: (options: {
    repositoryRoot: string;
    changelog: string;
    packageVersion: string;
    isFeatureBranchContext?: boolean;
    head?: string;
  }) => string[];
  getPostReleaseCommitRecords: (
    repositoryRoot: string,
    options?: { firstParent?: boolean },
  ) => Array<{ subject: string }> | null;
};

const metrics = docMetrics as unknown as MetricsModule;
const CHANGELOG = `## [Unreleased]\n\n- chore: keep the section non-empty\n`;

function git(dir: string, args: string[]) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'worldscript-tag-boundary-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'user.name', 'Tag Boundary Fixture']);
  git(dir, ['config', 'user.email', 'tag-boundary@example.com']);
  return dir;
}

function commit(dir: string, subject: string) {
  writeFileSync(join(dir, 'note.txt'), `${subject}\n${Date.now()}\n`);
  git(dir, ['add', 'note.txt']);
  git(dir, ['commit', '--quiet', '-m', subject]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

describe('release tag boundary', () => {
  it('reports one mismatch instead of the disjoint subject list', () => {
    const dir = initRepo();
    try {
      const tagged = commit(dir, 'chore: tagged root');
      git(dir, ['tag', 'v0.0.1', tagged]);
      git(dir, ['checkout', '--quiet', '--orphan', 'other']);
      commit(dir, 'feat: first disjoint subject');
      commit(dir, 'feat: second disjoint subject');
      const raw = metrics.getPostReleaseCommitRecords(dir, { firstParent: true });
      const findings = metrics.collectGovernedReleaseFindings({
        repositoryRoot: dir,
        changelog: CHANGELOG,
        packageVersion: '0.0.0',
      });
      expect((raw ?? []).length).toBeGreaterThan(1);
      expect(findings).toEqual(['CHANGELOG.md — TAG_BOUNDARY_MISMATCH']);
      expect(findings.join('\n')).not.toContain('feat:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a real undocumented subject after an ancestor tag', () => {
    const dir = initRepo();
    try {
      const tagged = commit(dir, 'chore: tagged root');
      git(dir, ['tag', 'v0.0.1', tagged]);
      commit(dir, 'feat: documented subject');
      const clean = metrics.collectGovernedReleaseFindings({
        repositoryRoot: dir,
        changelog: '## [Unreleased]\n\n- feat: documented subject\n',
        packageVersion: '0.0.0',
      });
      expect(metrics.classifyReleaseTagBoundary({ repositoryRoot: dir }).code).toBe('ANCESTOR');
      expect(clean).toEqual([]);
      commit(dir, 'feat: missing note');
      const drift = metrics.collectGovernedReleaseFindings({
        repositoryRoot: dir,
        changelog: '## [Unreleased]\n\n- feat: documented subject\n',
        packageVersion: '0.0.0',
      });
      expect(drift).toHaveLength(1);
      expect(drift[0]).toContain('feat: missing note');
      expect(drift[0]).not.toContain('TAG_BOUNDARY_MISMATCH');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('separates tagless, feature mismatch, shallow history, and a missing peel', () => {
    const bare = initRepo();
    const disjoint = initRepo();
    const shallowSource = initRepo();
    try {
      commit(bare, 'chore: no tag');
      expect(metrics.classifyReleaseTagBoundary({ repositoryRoot: bare }).code).toBe('TAGLESS');

      const tagged = commit(disjoint, 'chore: tagged root');
      git(disjoint, ['tag', 'v0.0.1', tagged]);
      git(disjoint, ['checkout', '--quiet', '--orphan', 'other']);
      commit(disjoint, 'feat: feature side');
      expect(
        metrics.classifyReleaseTagBoundary({ repositoryRoot: disjoint, context: 'feature' }).code,
      ).toBe('FEATURE_TAG_BOUNDARY_MISMATCH');

      commit(shallowSource, 'chore: shallow root');
      const shallowParent = mkdtempSync(join(tmpdir(), 'worldscript-tag-shallow-'));
      const shallow = join(shallowParent, 'repo');
      git(shallowSource, ['clone', '--quiet', '--depth', '1', `file://${shallowSource}`, shallow]);
      expect(metrics.classifyReleaseTagBoundary({ repositoryRoot: shallow }).code).toBe(
        'HISTORY_UNAVAILABLE',
      );
      rmSync(shallowParent, { recursive: true, force: true });

      mkdirSync(join(bare, '.git', 'refs', 'tags'), { recursive: true });
      writeFileSync(
        join(bare, '.git', 'refs', 'tags', 'v0.0.1'),
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
      );
      expect(metrics.classifyReleaseTagBoundary({ repositoryRoot: bare }).code).toBe(
        'HISTORY_UNAVAILABLE',
      );
    } finally {
      rmSync(bare, { recursive: true, force: true });
      rmSync(disjoint, { recursive: true, force: true });
      rmSync(shallowSource, { recursive: true, force: true });
    }
  });

  it('fails closed when history cannot be read after an ancestor tag', () => {
    const dir = initRepo();
    try {
      const tagged = commit(dir, 'chore: tagged root');
      git(dir, ['tag', 'v0.0.1', tagged]);
      commit(dir, 'feat: documented subject');
      expect(metrics.classifyReleaseTagBoundary({ repositoryRoot: dir }).code).toBe('ANCESTOR');
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
      // QNBS-v3: PATH git fails only the log subcommand; a config alias cannot override that builtin.
      writeFileSync(
        join(bin, 'git'),
        `#!/bin/sh\nif [ "$1" = "log" ]; then exit 1; fi\nexec ${realGit} "$@"\n`,
      );
      chmodSync(join(bin, 'git'), 0o755);
      const savedPath = process.env['PATH'];
      process.env['PATH'] = `${bin}:${savedPath ?? ''}`;
      try {
        expect(
          metrics.collectGovernedReleaseFindings({
            repositoryRoot: dir,
            changelog: '## [Unreleased]\n\n- feat: documented subject\n',
            packageVersion: '0.0.0',
          }),
        ).toEqual(['CHANGELOG.md — HISTORY_UNAVAILABLE']);
      } finally {
        if (savedPath === undefined) delete process.env['PATH'];
        else process.env['PATH'] = savedPath;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
