import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { mkdtemp as mkdtempAsync, rm as rmAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { isMainModule } from './ci-prepush-range-resolver.mjs';
import { computeDependencyState } from './dependency-state.mjs';
import { runBounded, runLocalBinaryDetailed } from './hooks/shared.mjs';

const DEFAULT_TSGO_ARGS = ['--project', 'tsconfig.tsgo.json', '--noEmit', '--checkers', '1'];

// QNBS-v3: sweeps entries orphaned by a prior crashed/killed run before creating a new one.
async function pruneStaleWorktrees(repoRoot, dependencies) {
  const runGit = dependencies.runBounded ?? runBounded;
  await runGit('git', ['worktree', 'prune'], { cwd: repoRoot });
}

async function createIsolatedWorktree(sha, repoRoot, dependencies) {
  const runGit = dependencies.runBounded ?? runBounded;
  const makeTempDir =
    dependencies.mkdtempFn ?? (() => mkdtempAsync(join(tmpdir(), 'worldscript-exact-tree-')));
  await pruneStaleWorktrees(repoRoot, dependencies);
  let path;
  try {
    path = await makeTempDir();
  } catch {
    return { ok: false, path: undefined };
  }
  const result = await runGit('git', ['worktree', 'add', '--detach', path, sha], { cwd: repoRoot });
  if (result.error || result.timedOut || result.interrupted || result.status !== 0) {
    return { ok: false, path };
  }
  return { ok: true, path };
}

// QNBS-v3: fail-closed -- git's own removal failing falls back to a raw sweep plus a metadata prune.
async function removeIsolatedWorktree(worktreePath, repoRoot, dependencies) {
  if (!worktreePath) return;
  const runGit = dependencies.runBounded ?? runBounded;
  const removeDir = dependencies.rmFn ?? ((path) => rmAsync(path, { recursive: true, force: true }));
  const result = await runGit('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: repoRoot,
  });
  if (result.error || result.timedOut || result.interrupted || result.status !== 0) {
    try {
      await removeDir(worktreePath);
    } catch {
      // Best-effort: nothing more can be done from here; the directory is under os.tmpdir().
    }
    await runGit('git', ['worktree', 'prune'], { cwd: repoRoot });
  }
}

// QNBS-v3: real node_modules install per verification is exactly the unbounded cost this avoids.
function linkNodeModules(worktreePath, source, dependencies) {
  const symlinkFn =
    dependencies.symlinkFn ??
    ((target, linkPath) => symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir'));
  try {
    symlinkFn(source, join(worktreePath, 'node_modules'));
    return true;
  } catch {
    return false;
  }
}

// QNBS-v3: precedence shape mirrors aggregateDiagnosticState, kept separate -- different vocabulary.
function aggregateExactTreeState(states) {
  const relevant = states.filter((state) => state !== 'NOT_APPLICABLE');
  if (relevant.length === 0) return 'NOT_APPLICABLE';
  if (relevant.includes('FAIL')) return 'FAIL';
  if (relevant.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

// QNBS-v3: never throws -- an opt-in diagnostic tool must fail closed to UNKNOWN, not crash the caller.
export async function verifyExactTreeTypecheck(sha, repoRoot = process.cwd(), dependencies = {}) {
  try {
    const dependencyStateForRef =
      dependencies.dependencyStateForRef ?? ((ref) => computeDependencyState(ref, repoRoot));
    // QNBS-v3: precondition for a trustworthy symlink, not a skip gate -- the check always runs.
    if (dependencyStateForRef(sha) !== 'MATCHES') return 'UNKNOWN';

    const created = await createIsolatedWorktree(sha, repoRoot, dependencies);
    if (!created.ok) {
      await removeIsolatedWorktree(created.path, repoRoot, dependencies);
      return 'UNKNOWN';
    }

    try {
      const nodeModulesSource = dependencies.nodeModulesSource ?? join(repoRoot, 'node_modules');
      if (!linkNodeModules(created.path, nodeModulesSource, dependencies)) return 'UNKNOWN';

      const runDetailed = dependencies.runLocalBinaryDetailed ?? runLocalBinaryDetailed;
      const tsgoArgs = dependencies.tsgoArgs ?? DEFAULT_TSGO_ARGS;
      const result = await runDetailed('tsgo', tsgoArgs, {
        root: created.path,
        cwd: created.path,
      });
      if (result.error || result.timedOut || result.interrupted) return 'UNKNOWN';
      return result.status === 0 ? 'PASS' : 'FAIL';
    } finally {
      await removeIsolatedWorktree(created.path, repoRoot, dependencies);
    }
  } catch {
    return 'UNKNOWN';
  }
}

export async function verifyExactTreeForShas(shas, repoRoot = process.cwd(), dependencies = {}) {
  const unique = [...new Set(shas)];
  if (unique.length === 0) return 'NOT_APPLICABLE';
  const states = [];
  for (const sha of unique) {
    // QNBS-v3: sequential, never parallel -- bounded resource use on constrained developer hardware.
    states.push(await verifyExactTreeTypecheck(sha, repoRoot, dependencies));
  }
  return aggregateExactTreeState(states);
}

function resolveRef(ref, dependencies) {
  const runGitSync =
    dependencies.runGitSync ?? ((args) => spawnSync('git', args, { encoding: 'utf8' }));
  const result = runGitSync(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

export async function main(argv = process.argv.slice(2)) {
  const refs = argv.length > 0 ? argv : ['HEAD'];
  const shas = [];
  for (const ref of refs) {
    const sha = resolveRef(ref);
    if (!sha) {
      console.error(`[verify-exact-tree] could not resolve ref: ${ref}`);
      process.exitCode = 1;
      return;
    }
    shas.push(sha);
  }
  console.log(`[verify-exact-tree] verifying ${shas.length} commit(s) in isolated worktree(s)...`);
  const state = await verifyExactTreeForShas(shas);
  console.log(`[verify-exact-tree] result: ${state}`);
  if (state === 'UNKNOWN') {
    console.log(
      '[verify-exact-tree] could not be established (dependencies not reconciled/matched locally, or a worktree/tsgo step failed); required CI remains authoritative.',
    );
  } else if (state === 'FAIL') {
    console.log('[verify-exact-tree] the exact committed tree does not typecheck in isolation.');
    process.exitCode = 1;
  }
}

// QNBS-v3: guard execution so this module can be imported for testing without running the CLI.
if (isMainModule(process.argv[1], import.meta.url)) await main();
