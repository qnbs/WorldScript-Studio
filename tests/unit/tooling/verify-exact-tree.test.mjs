import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  verifyExactTreeForShas,
  verifyExactTreeTypecheck,
} from '../../../scripts/verify-exact-tree.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeTinyTsRepo(source) {
  const root = mkdtempSync(join(process.cwd(), '.worldscript-exact-tree-'));
  temporaryRoots.push(root);
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '--quiet', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'esnext',
        target: 'es2022',
        moduleResolution: 'bundler',
        skipLibCheck: true,
      },
      include: ['index.ts'],
    }),
  );
  writeFileSync(join(root, 'index.ts'), source);
  git(['add', '-A']);
  git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test']);
  const sha = git(['rev-parse', 'HEAD']).trim();
  return { root, sha };
}

const realProjectNodeModules = join(process.cwd(), 'node_modules');
const tinyTsgoArgs = ['--project', 'tsconfig.json', '--noEmit', '--checkers', '1'];

describe('verifyExactTreeTypecheck (precondition -- not a skip gate)', () => {
  it('reports UNKNOWN without creating a worktree when dependencyState is not MATCHES', async () => {
    const state = await verifyExactTreeTypecheck('deadbeef', '/repo', {
      dependencyStateForRef: () => 'DIVERGED',
      runBounded: () => {
        throw new Error('must not be called when the precondition is not met');
      },
    });
    assert.equal(state, 'UNKNOWN');
  });

  it('reports UNKNOWN rather than propagating a throw from an injected dependency', async () => {
    const state = await verifyExactTreeTypecheck('deadbeef', '/repo', {
      dependencyStateForRef: () => {
        throw new Error('boom');
      },
    });
    assert.equal(state, 'UNKNOWN');
  });
});

describe('verifyExactTreeTypecheck (real git worktree + real tsgo, small fixture)', () => {
  it('reports PASS for a commit that typechecks cleanly in isolation', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    const state = await verifyExactTreeTypecheck(sha, root, {
      dependencyStateForRef: () => 'MATCHES',
      nodeModulesSource: realProjectNodeModules,
      tsgoArgs: tinyTsgoArgs,
    });
    assert.equal(state, 'PASS');
  });

  it('reports FAIL for a commit with a genuine type error in isolation', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = "not a number";\n');
    const state = await verifyExactTreeTypecheck(sha, root, {
      dependencyStateForRef: () => 'MATCHES',
      nodeModulesSource: realProjectNodeModules,
      tsgoArgs: tinyTsgoArgs,
    });
    assert.equal(state, 'FAIL');
  });

  it('leaves no worktree registered after a successful run (cleanup ran)', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    await verifyExactTreeTypecheck(sha, root, {
      dependencyStateForRef: () => 'MATCHES',
      nodeModulesSource: realProjectNodeModules,
      tsgoArgs: tinyTsgoArgs,
    });
    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(list.trim().split('\n\n').length, 1, `expected only the main worktree: ${list}`);
  });
});

describe('verifyExactTreeTypecheck (fail-closed worktree lifecycle, injected failures)', () => {
  it('reports UNKNOWN when git worktree add fails', async () => {
    const state = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      dependencyStateForRef: () => 'MATCHES',
      runBounded: (_command, args) => {
        if (args.includes('add')) return { status: 1, error: null, timedOut: false, interrupted: false };
        return { status: 0, error: null, timedOut: false, interrupted: false };
      },
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
    });
    assert.equal(state, 'UNKNOWN');
  });

  it('falls back to a raw directory sweep plus prune when git worktree remove fails', async () => {
    let removeCalled = false;
    let pruneCallCount = 0;
    let rmCalled = false;
    const state = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      dependencyStateForRef: () => 'MATCHES',
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded: (_command, args) => {
        if (args.includes('prune')) {
          pruneCallCount += 1;
          return { status: 0, error: null, timedOut: false, interrupted: false };
        }
        if (args.includes('add')) return { status: 0, error: null, timedOut: false, interrupted: false };
        if (args.includes('remove')) {
          removeCalled = true;
          return { status: 1, error: null, timedOut: false, interrupted: false };
        }
        return { status: 0, error: null, timedOut: false, interrupted: false };
      },
      symlinkFn: () => {
        throw new Error('force UNKNOWN before any real tsgo invocation is attempted');
      },
      rmFn: async () => {
        rmCalled = true;
      },
    });
    assert.equal(state, 'UNKNOWN');
    assert.equal(removeCalled, true);
    assert.equal(rmCalled, true);
    // QNBS-v3: proactive prune before creating the worktree, plus the fallback prune after removal fails.
    assert.equal(pruneCallCount, 2);
  });
});

describe('verifyExactTreeForShas (dedup, sequential, aggregation)', () => {
  it('deduplicates identical SHAs so the underlying check runs once', async () => {
    const calls = [];
    const state = await verifyExactTreeForShas(['a'.repeat(40), 'a'.repeat(40)], '/repo', {
      dependencyStateForRef: (sha) => {
        calls.push(sha);
        return 'MATCHES';
      },
      runBounded: () => ({ status: 0, error: null, timedOut: false, interrupted: false }),
      symlinkFn: () => {
        throw new Error('force UNKNOWN quickly -- this test only cares about call count');
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(state, 'UNKNOWN');
  });

  it('returns NOT_APPLICABLE for an empty list', async () => {
    assert.equal(await verifyExactTreeForShas([], '/repo'), 'NOT_APPLICABLE');
  });

  it('aggregates with FAIL outranking UNKNOWN', async () => {
    const shaFail = 'a'.repeat(40);
    const shaUnknown = 'b'.repeat(40);
    const state = await verifyExactTreeForShas([shaFail, shaUnknown], '/repo', {
      dependencyStateForRef: (sha) => (sha === shaUnknown ? 'DIVERGED' : 'MATCHES'),
      runBounded: () => ({ status: 0, error: null, timedOut: false, interrupted: false }),
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      symlinkFn: () => {},
      runLocalBinaryDetailed: async () => ({
        status: 1,
        error: null,
        timedOut: false,
        interrupted: false,
      }),
    });
    // QNBS-v3: shaFail -> real FAIL via the mocked tsgo run; shaUnknown -> UNKNOWN via the precondition.
    assert.equal(state, 'FAIL');
  });
});
