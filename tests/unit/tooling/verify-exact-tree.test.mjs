import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  createIsolatedWorktree,
  installDependencies,
  main,
  removeIsolatedWorktree,
  resolveRef,
  verifyExactTreeForShas,
  verifyExactTreeTypecheck,
} from '../../../scripts/verify-exact-tree.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeTinyTsRepo(source) {
  const root = mkdtempSync(join(process.cwd(), '.worldscript-exact-tree-'));
  temporaryRoots.push(root);
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, module: 'esnext', target: 'es2022' },
      include: ['index.ts'],
    }),
  );
  writeFileSync(join(root, 'index.ts'), source);
  git(root, ['add', '-A']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test']);
  const sha = git(root, ['rev-parse', 'HEAD']).trim();
  return { root, sha };
}

// QNBS-v3: root/package-local/transitive links, zero external deps (offline metadata can't resolve fresh).
function makeWorkspaceFixture(innerContent) {
  const root = mkdtempSync(join(process.cwd(), '.worldscript-exact-tree-ws-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'packages', 'demo-pkg'), { recursive: true });
  mkdirSync(join(root, 'packages', 'inner-pkg'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    '{"name":"fixture-root","private":true,"dependencies":{"@fixture/demo-pkg":"workspace:*"}}\n',
  );
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(
    join(root, 'packages', 'demo-pkg', 'package.json'),
    '{"name":"@fixture/demo-pkg","version":"1.0.0","dependencies":{"@fixture/inner-pkg":"workspace:*"}}\n',
  );
  writeFileSync(join(root, 'packages', 'demo-pkg', 'index.js'), "export { INNER } from '@fixture/inner-pkg';\n");
  writeFileSync(
    join(root, 'packages', 'inner-pkg', 'package.json'),
    '{"name":"@fixture/inner-pkg","version":"1.0.0"}\n',
  );
  writeFileSync(join(root, 'packages', 'inner-pkg', 'index.js'), `export const INNER = '${innerContent}';\n`);
  // QNBS-v3: load-bearing -- without this, git add -A commits the symlinks and a bare checkout alone would pass.
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  // QNBS-v3: generates a real, valid lockfile for this fixture -- workspace-only, no network needed.
  execFileSync('pnpm', ['install', '--offline'], { cwd: root, stdio: 'ignore' });
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test']);
  const sha = git(root, ['rev-parse', 'HEAD']).trim();
  return { root, sha };
}

describe('createIsolatedWorktree / removeIsolatedWorktree (real git, no pnpm)', () => {
  it('creates a worktree at the exact commit and leaves nothing registered after cleanup', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    const created = await createIsolatedWorktree(sha, root, {});
    assert.equal(created.ok, true);
    assert.equal(readFileSync(join(created.path, 'index.ts'), 'utf8'), 'const x: number = 1;\n');
    await removeIsolatedWorktree(created.path, root, {});
    const list = git(root, ['worktree', 'list', '--porcelain']);
    assert.equal(list.trim().split('\n\n').length, 1, `expected only the main worktree: ${list}`);
  });

  it('falls back to a raw directory sweep plus prune when git worktree remove fails', async () => {
    let removeCalled = false;
    let pruneCallCount = 0;
    let rmCalled = false;
    await removeIsolatedWorktree('/tmp/worldscript-exact-tree-fake', '/repo', {
      runBounded: (_command, args) => {
        if (args.includes('prune')) {
          pruneCallCount += 1;
          return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
        }
        if (args.includes('remove')) {
          removeCalled = true;
          return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
        }
        return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
      },
      rmFn: async () => {
        rmCalled = true;
      },
    });
    assert.equal(removeCalled, true);
    assert.equal(rmCalled, true);
    assert.equal(pruneCallCount, 1);
  });
});

describe('bare-call regressions (dependencies argument omitted, matching resolveRef)', () => {
  it('createIsolatedWorktree does not throw when called without a dependencies argument', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    const created = await createIsolatedWorktree(sha, root);
    assert.equal(created.ok, true);
    await removeIsolatedWorktree(created.path, root);
  });

  it('removeIsolatedWorktree does not throw when called without a dependencies argument', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    const created = await createIsolatedWorktree(sha, root, {});
    await assert.doesNotReject(() => removeIsolatedWorktree(created.path, root));
  });

  it('installDependencies does not throw when called without a dependencies argument', async () => {
    // QNBS-v3: an unreachable repoRoot fails fast, but the call itself must not throw on undefined deps.
    await assert.doesNotReject(() => installDependencies('/tmp/worldscript-exact-tree-nonexistent'));
  });

  it('pruneStaleWorktrees (via createIsolatedWorktree) does not throw with dependencies omitted', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    // QNBS-v3: createIsolatedWorktree forwards dependencies to pruneStaleWorktrees internally.
    const created = await createIsolatedWorktree(sha, root);
    assert.equal(created.ok, true);
    await removeIsolatedWorktree(created.path, root);
  });
});

describe('installDependencies (workspace-package soundness -- the core regression)', () => {
  it('resolves workspace packages to the isolated worktree\'s committed source, never the live checkout, including a transitive package-local link', async () => {
    const { root, sha } = makeWorkspaceFixture('committed');

    // QNBS-v3: mutate the LIVE checkout AFTER committing -- a leak would read this instead of committed.
    writeFileSync(
      join(root, 'packages', 'inner-pkg', 'index.js'),
      "export const INNER = 'LEAKED-live-checkout-value';\n",
    );

    const created = await createIsolatedWorktree(sha, root, {});
    assert.equal(created.ok, true);
    try {
      const installed = await installDependencies(created.path, {});
      assert.equal(installed, true);

      // QNBS-v3: root workspace link (node_modules/@fixture/demo-pkg) resolving into the isolated tree.
      const demoPkgContent = readFileSync(
        join(created.path, 'node_modules', '@fixture', 'demo-pkg', 'index.js'),
        'utf8',
      );
      assert.match(demoPkgContent, /@fixture\/inner-pkg/);

      // QNBS-v3: the critical assertion -- package-local, transitive workspace link resolves committed.
      const innerContent = readFileSync(
        join(created.path, 'packages', 'demo-pkg', 'node_modules', '@fixture', 'inner-pkg', 'index.js'),
        'utf8',
      );
      assert.match(innerContent, /'committed'/);
      assert.doesNotMatch(innerContent, /LEAKED/);

      // QNBS-v3: also verify via Node's own resolution, wherever pnpm actually placed the hoisted link.
      const resolved = execFileSync('node', ['-e', "process.stdout.write(require('fs').readFileSync(require.resolve('@fixture/inner-pkg'), 'utf8'))"], {
        cwd: join(created.path, 'packages', 'demo-pkg'),
        encoding: 'utf8',
      });
      assert.match(resolved, /'committed'/);
      assert.doesNotMatch(resolved, /LEAKED/);
    } finally {
      await removeIsolatedWorktree(created.path, root, {});
    }
  });

  it('never executes a side-effecting .pnpmfile.cjs, even its top-level (require-time) code', async () => {
    const { root } = makeWorkspaceFixture('committed');
    const markerRoot = mkdtempSync(join(process.cwd(), '.worldscript-exact-tree-pnpmfilemark-'));
    temporaryRoots.push(markerRoot);
    const markerFile = join(markerRoot, 'pnpmfile-ran.txt');
    // QNBS-v3: top-level (require-time) side effect -- proves --ignore-pnpmfile stops it before any hook fires.
    writeFileSync(
      join(root, '.pnpmfile.cjs'),
      `require('fs').writeFileSync(${JSON.stringify(markerFile)}, 'executed');\nmodule.exports = { hooks: {} };\n`,
    );
    git(root, ['add', '-A']);
    git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'add pnpmfile']);
    const pnpmfileSha = git(root, ['rev-parse', 'HEAD']).trim();

    const created = await createIsolatedWorktree(pnpmfileSha, root, {});
    assert.equal(created.ok, true);
    try {
      const installed = await installDependencies(created.path, {});
      assert.equal(installed, true);
      assert.equal(existsSync(markerFile), false, '.pnpmfile.cjs must not have executed');
    } finally {
      await removeIsolatedWorktree(created.path, root, {});
    }
  });

  it('returns false (mapped to UNKNOWN by callers) when the frozen-lockfile install fails', async () => {
    const installed = await installDependencies('/tmp/worldscript-exact-tree-fake', {
      runBounded: async () => ({
        status: 1,
        error: null,
        signal: null,
        timedOut: false,
        interrupted: false,
      }),
    });
    assert.equal(installed, false);
  });
});

describe('verifyExactTreeTypecheck (fail-closed lifecycle, signal/status semantics -- DI only)', () => {
  it('reports UNKNOWN when git worktree add fails', async () => {
    const state = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      runBounded: (_command, args) => {
        if (args.includes('add')) return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
        return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
      },
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
    });
    assert.equal(state, 'UNKNOWN');
  });

  it('reports UNKNOWN, never a false PASS/FAIL, when the install fails', async () => {
    const state = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded: (_command, args) => {
        if (args.includes('worktree')) return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
        // QNBS-v3: the pnpm install call -- fails, must map to UNKNOWN, and tsgo must never run.
        return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
      },
      runLocalBinaryDetailed: async () => {
        throw new Error('must not be called -- install already failed');
      },
    });
    assert.equal(state, 'UNKNOWN');
  });

  it('reports PASS/FAIL correctly from a genuine tsgo exit status once install succeeds (DI)', async () => {
    const runBounded = () => ({ status: 0, error: null, signal: null, timedOut: false, interrupted: false });
    const pass = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded,
      runLocalBinaryDetailed: async () => ({
        status: 0,
        error: null,
        signal: null,
        timedOut: false,
        interrupted: false,
      }),
    });
    assert.equal(pass, 'PASS');

    const fail = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded,
      runLocalBinaryDetailed: async () => ({
        status: 2,
        error: null,
        signal: null,
        timedOut: false,
        interrupted: false,
      }),
    });
    assert.equal(fail, 'FAIL');
  });

  it('reports UNKNOWN, not FAIL, when tsgo is terminated by a signal (e.g. external OOM kill)', async () => {
    const state = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded: () => ({ status: 0, error: null, signal: null, timedOut: false, interrupted: false }),
      runLocalBinaryDetailed: async () => ({
        status: null,
        signal: 'SIGKILL',
        error: null,
        timedOut: false,
        interrupted: false,
      }),
    });
    assert.equal(state, 'UNKNOWN');
  });

  it('reports UNKNOWN, not FAIL, on a null status with no signal (defensive)', async () => {
    const state = await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded: () => ({ status: 0, error: null, signal: null, timedOut: false, interrupted: false }),
      runLocalBinaryDetailed: async () => ({
        status: null,
        signal: null,
        error: null,
        timedOut: false,
        interrupted: false,
      }),
    });
    assert.equal(state, 'UNKNOWN');
  });

  it('passes a generous default timeoutMs to the tsgo call, overridable via dependencies', async () => {
    const runBounded = () => ({ status: 0, error: null, signal: null, timedOut: false, interrupted: false });
    let seenTimeoutMs;
    await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded,
      runLocalBinaryDetailed: async (_binary, _args, options) => {
        seenTimeoutMs = options?.timeoutMs;
        return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
      },
    });
    // QNBS-v3: repo docs cite ~300s for the full multi-checker typecheck; the default must clear that too.
    assert.ok(seenTimeoutMs >= 300_000, `expected margin above the documented ~300s figure, got ${seenTimeoutMs}`);

    let overriddenTimeoutMs;
    await verifyExactTreeTypecheck('a'.repeat(40), '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded,
      tsgoTimeoutMs: 42_000,
      runLocalBinaryDetailed: async (_binary, _args, options) => {
        overriddenTimeoutMs = options?.timeoutMs;
        return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
      },
    });
    assert.equal(overriddenTimeoutMs, 42_000);
  });

  it('canonicalizes a relative repoRoot to an absolute path before any git/install call', async () => {
    const seenCwds = [];
    await verifyExactTreeTypecheck('a'.repeat(40), '.', {
      listTreeFiles: (_sha, cwd) => {
        seenCwds.push(cwd);
        return [];
      },
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded: (_command, _args, options) => {
        seenCwds.push(options?.cwd);
        return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
      },
    });
    assert.ok(seenCwds.length > 0);
    for (const cwd of seenCwds) assert.equal(cwd, resolve('.'), `expected absolute cwd, got ${cwd}`);
  });
});

describe('verifyNoTrackedNodeModules (P1: refuse before any materialization touches disk)', () => {
  function makeRepoWithTrackedPath(relativePath, { symlink } = {}) {
    const root = mkdtempSync(join(process.cwd(), '.worldscript-exact-tree-nm-'));
    temporaryRoots.push(root);
    git(root, ['init', '--quiet', '--initial-branch=main']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'test']);
    writeFileSync(join(root, 'README.md'), 'fixture\n');
    const fullPath = join(root, relativePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    if (symlink) {
      execFileSync('ln', ['-s', '/nonexistent-target', fullPath]);
    } else {
      writeFileSync(fullPath, '#!/bin/sh\necho attacker-controlled\n');
    }
    git(root, ['add', '-A']);
    git(root, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test']);
    const sha = git(root, ['rev-parse', 'HEAD']).trim();
    return { root, sha };
  }

  // QNBS-v3: counts calls, not just final state -- a missing precondition check could also catch-to-UNKNOWN.
  function refusingMaterializationSpy() {
    const calls = { runBounded: 0, runLocalBinaryDetailed: 0 };
    return {
      calls,
      runBounded: async () => {
        calls.runBounded += 1;
        throw new Error('must not be called -- a tracked node_modules must be refused before materialization');
      },
      runLocalBinaryDetailed: async () => {
        calls.runLocalBinaryDetailed += 1;
        throw new Error('must not be called -- a tracked node_modules must be refused before materialization');
      },
    };
  }

  it('refuses a commit with a tracked root-level node_modules/.bin/tsgo (UNKNOWN, no materialization)', async () => {
    const { root, sha } = makeRepoWithTrackedPath('node_modules/.bin/tsgo');
    const spy = refusingMaterializationSpy();
    const state = await verifyExactTreeTypecheck(sha, root, spy);
    assert.equal(state, 'UNKNOWN');
    assert.equal(spy.calls.runBounded, 0, 'materialization must never start for a tracked node_modules commit');
  });

  it('refuses a commit with a tracked nested packages/foo/node_modules/x (UNKNOWN, no materialization)', async () => {
    const { root, sha } = makeRepoWithTrackedPath('packages/foo/node_modules/x/index.js');
    const spy = refusingMaterializationSpy();
    const state = await verifyExactTreeTypecheck(sha, root, spy);
    assert.equal(state, 'UNKNOWN');
    assert.equal(spy.calls.runBounded, 0, 'materialization must never start for a tracked node_modules commit');
  });

  it('refuses a commit with a tracked node_modules symlink itself (UNKNOWN, no materialization)', async () => {
    const { root, sha } = makeRepoWithTrackedPath('node_modules', { symlink: true });
    const spy = refusingMaterializationSpy();
    const state = await verifyExactTreeTypecheck(sha, root, spy);
    assert.equal(state, 'UNKNOWN');
    assert.equal(spy.calls.runBounded, 0, 'materialization must never start for a tracked node_modules commit');
  });

  it('refuses a case-variant NODE_MODULES/.bin/tsgo (aliases node_modules on case-insensitive filesystems)', async () => {
    const { root, sha } = makeRepoWithTrackedPath('NODE_MODULES/.bin/tsgo');
    const spy = refusingMaterializationSpy();
    const state = await verifyExactTreeTypecheck(sha, root, spy);
    assert.equal(state, 'UNKNOWN');
    assert.equal(spy.calls.runBounded, 0, 'materialization must never start for a tracked node_modules commit');
  });

  it('leaves an ordinary commit with no tracked node_modules eligible for materialization', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    let worktreeAddCalled = false;
    const state = await verifyExactTreeTypecheck(sha, root, {
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded: (_command, args) => {
        if (args.includes('add')) worktreeAddCalled = true;
        return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
      },
    });
    assert.equal(worktreeAddCalled, true);
    assert.equal(state, 'UNKNOWN'); // fake path -- worktree add itself is mocked to fail, but it was reached.
  });
});

describe('createIsolatedWorktree (P2: post-checkout hooks must not execute)', () => {
  it('does not execute a configured post-checkout hook while materializing the isolated worktree', async () => {
    const { root, sha } = makeTinyTsRepo('const x: number = 1;\n');
    const markerRoot = mkdtempSync(join(process.cwd(), '.worldscript-exact-tree-hookmark-'));
    temporaryRoots.push(markerRoot);
    const markerFile = join(markerRoot, 'hook-ran.txt');
    const hooksDir = join(root, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(hooksDir, 'post-checkout'), `#!/bin/sh\necho ran > "${markerFile}"\n`, { mode: 0o755 });

    const created = await createIsolatedWorktree(sha, root, {});
    try {
      assert.equal(created.ok, true);
      assert.equal(existsSync(markerFile), false, 'post-checkout hook must not have run');
    } finally {
      await removeIsolatedWorktree(created.path, root, {});
    }
  });
});

describe('resolveRef (bounded, output-capturing ref resolution)', () => {
  it('resolves a valid ref to its full commit SHA via the injected runGit', () => {
    const sha = resolveRef('HEAD', '/repo', {
      runGit: (args) => {
        assert.deepEqual(args, ['rev-parse', '--verify', 'HEAD^{commit}']);
        return { status: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '', error: undefined };
      },
    });
    assert.equal(sha, 'a'.repeat(40));
  });

  it('returns null for a ref that does not resolve', () => {
    const sha = resolveRef('not-a-ref', '/repo', {
      runGit: () => ({ status: 128, stdout: '', stderr: 'fatal: bad revision', error: undefined }),
    });
    assert.equal(sha, null);
  });

  // QNBS-v3: regression -- the CLI path must not crash when no dependencies argument is passed.
  it('does not throw when called with only (ref, repoRoot), matching a bare call site', () => {
    assert.doesNotThrow(() => resolveRef('HEAD', process.cwd()));
  });
});

describe('verifyExactTreeForShas (dedup, sequential, aggregation)', () => {
  it('deduplicates identical SHAs so the underlying check runs once', async () => {
    let calls = 0;
    const state = await verifyExactTreeForShas(['a'.repeat(40), 'a'.repeat(40)], '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => {
        calls += 1;
        return '/tmp/worldscript-exact-tree-fake';
      },
      runBounded: (_command, args) => {
        if (args.includes('add')) return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
        return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
      },
    });
    assert.equal(calls, 1);
    assert.equal(state, 'UNKNOWN');
  });

  it('returns NOT_APPLICABLE for an empty list', async () => {
    assert.equal(await verifyExactTreeForShas([], '/repo'), 'NOT_APPLICABLE');
  });

  it('aggregates with FAIL outranking UNKNOWN', async () => {
    // QNBS-v3: sequential processing -- alternate by call order for one genuine FAIL, one UNKNOWN.
    let tsgoCallCount = 0;
    const state = await verifyExactTreeForShas(['a'.repeat(40), 'b'.repeat(40)], '/repo', {
      listTreeFiles: () => [],
      mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      runBounded: () => ({ status: 0, error: null, signal: null, timedOut: false, interrupted: false }),
      runLocalBinaryDetailed: async () => {
        tsgoCallCount += 1;
        // QNBS-v3: first sha -> genuine FAIL (numeric non-zero exit); second sha -> UNKNOWN (signaled).
        return tsgoCallCount === 1
          ? { status: 2, error: null, signal: null, timedOut: false, interrupted: false }
          : { status: null, error: null, signal: 'SIGKILL', timedOut: false, interrupted: false };
      },
    });
    assert.equal(tsgoCallCount, 2);
    assert.equal(state, 'FAIL');
  });
});

describe('main (real CLI entry path, realistic DI)', () => {
  it('resolves HEAD by default, verifies it, and prints the result without crashing', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (message) => logs.push(message);
    try {
      await main([], {
        repoRoot: '/repo',
        listTreeFiles: () => [],
        runGit: () => ({ status: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '', error: undefined }),
        runBounded: (_command, args) => {
          if (args.includes('add')) return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
          return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
        },
        mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      });
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes('result: UNKNOWN')), logs.join('\n'));
  });

  it('resolves and verifies multiple explicit refs', async () => {
    const resolvedRefs = [];
    const logs = [];
    const originalLog = console.log;
    console.log = (message) => logs.push(message);
    try {
      await main(['main', 'feature-branch'], {
        repoRoot: '/repo',
        listTreeFiles: () => [],
        runGit: (args) => {
          resolvedRefs.push(args[2]);
          return { status: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '', error: undefined };
        },
        runBounded: (_command, args) => {
          if (args.includes('add')) return { status: 1, error: null, signal: null, timedOut: false, interrupted: false };
          return { status: 0, error: null, signal: null, timedOut: false, interrupted: false };
        },
        mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
      });
    } finally {
      console.log = originalLog;
    }
    assert.deepEqual(resolvedRefs, ['main^{commit}', 'feature-branch^{commit}']);
    assert.ok(logs.some((line) => line.includes('verifying 2 commit(s)')), logs.join('\n'));
  });

  // QNBS-v3: regression -- the real resolveRef(ref) call-site crash; helper-only tests missed main().
  it('reports a clear error and a non-zero exit code for an unresolvable ref, without crashing', async () => {
    const errors = [];
    const originalError = console.error;
    console.error = (message) => errors.push(message);
    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      await main(['not-a-real-ref'], {
        repoRoot: '/repo',
        runGit: () => ({ status: 128, stdout: '', stderr: 'fatal: bad revision', error: undefined }),
      });
      assert.equal(process.exitCode, 1);
    } finally {
      console.error = originalError;
      process.exitCode = originalExitCode;
    }
    assert.ok(errors.some((line) => line.includes('could not resolve ref: not-a-real-ref')), errors.join('\n'));
  });

  it('sets a non-zero exit code when the exact tree fails to typecheck', async () => {
    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      await main(['HEAD'], {
        repoRoot: '/repo',
        listTreeFiles: () => [],
        runGit: () => ({ status: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '', error: undefined }),
        runBounded: () => ({ status: 0, error: null, signal: null, timedOut: false, interrupted: false }),
        mkdtempFn: async () => '/tmp/worldscript-exact-tree-fake',
        runLocalBinaryDetailed: async () => ({
          status: 2,
          error: null,
          signal: null,
          timedOut: false,
          interrupted: false,
        }),
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
