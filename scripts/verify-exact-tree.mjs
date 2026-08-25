import { spawnSync } from 'node:child_process';
import { mkdtemp as mkdtempAsync, rm as rmAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import process from 'node:process';
import { isMainModule } from './ci-prepush-range-resolver.mjs';
import { computeDependencyState, listTreeEntries, readFileAtRef } from './dependency-state.mjs';
import { runBounded, runLocalBinaryDetailed } from './hooks/shared.mjs';
import { runGit as defaultRunGit } from './signing/signing-core.mjs';

// QNBS-v3: distinct from every other UNKNOWN cause -- explicit user intent must stop the whole run.
class ExactTreeInterrupted extends Error {
  constructor() {
    super('verify-exact-tree: interrupted');
    this.name = 'ExactTreeInterrupted';
  }
}

const DEFAULT_TSGO_ARGS = ['--project', 'tsconfig.tsgo.json', '--noEmit', '--checkers', '1'];
// QNBS-v3: measured ~2m20s for the full project on this hardware with a warm store; 5min gives margin.
const DEFAULT_INSTALL_TIMEOUT_MS = 300_000;
// QNBS-v3: single-checker measured ~56s; docs cite ~300s for full typecheck -- 6min clears both with margin.
const DEFAULT_TSGO_TIMEOUT_MS = 360_000;

// QNBS-v3: lifecycle commands (worktree/install) -- any non-zero or unreadable exit fails outright.
function boundedCommandFailed(result) {
  return Boolean(
    result.error || result.timedOut || result.interrupted || result.signal || result.status !== 0,
  );
}

// QNBS-v3: tsgo only -- a genuine numeric non-zero status is a real FAIL; a signal/timeout/OOM is UNKNOWN.
function tsgoResultUnknown(result) {
  return Boolean(
    result.error || result.timedOut || result.interrupted || result.signal || typeof result.status !== 'number',
  );
}

// QNBS-v3: sweeps entries orphaned by a prior crashed/killed run before creating a new one.
async function pruneStaleWorktrees(repoRoot, dependencies = {}) {
  const runGit = dependencies.runBounded ?? runBounded;
  const result = await runGit('git', ['worktree', 'prune'], { cwd: repoRoot });
  if (result.interrupted) throw new ExactTreeInterrupted();
}

// QNBS-v3: an arbitrary ref can force-track a node_modules path anywhere; could execute/redirect. Fail closed.
function hasTrackedNodeModules(entries) {
  // QNBS-v3: case-insensitive -- NODE_MODULES aliases node_modules on Windows/macOS checkouts.
  return entries.some((entry) =>
    entry.path.split('/').some((segment) => segment.toLowerCase() === 'node_modules'),
  );
}

// QNBS-v3: a tracked symlink whose target escapes the tree root would let tsgo read live/external content.
function hasEscapingSymlink(entries, sha, repoRoot, dependencies) {
  const readBlob = dependencies.readBlobAtRef ?? readFileAtRef;
  for (const entry of entries) {
    if (entry.mode !== '120000') continue;
    const targetBuffer = readBlob(sha, entry.path, repoRoot);
    if (targetBuffer === null) return true; // unreadable target -- fail closed, treat as escaping.
    const target = targetBuffer.toString('utf8').trim();
    if (posix.isAbsolute(target)) return true;
    const resolved = posix.normalize(posix.join(posix.dirname(entry.path), target));
    if (resolved.startsWith('..') || posix.isAbsolute(resolved)) return true;
  }
  return false;
}

// QNBS-v3: checked against the exact commit's own git objects, before any worktree/pnpm step touches disk.
function verifyExactTreePreflight(sha, repoRoot, dependencies = {}) {
  const listEntries = dependencies.listTreeEntries ?? listTreeEntries;
  const entries = listEntries(sha, repoRoot);
  if (entries === null) return false; // an unreadable tree can never be proven clean.
  if (hasTrackedNodeModules(entries)) return false;
  if (hasEscapingSymlink(entries, sha, repoRoot, dependencies)) return false;
  return true;
}

// QNBS-v3: hook-free dir so 'git worktree add' can't run repo/user hooks -- scoped via -c, not global config.
async function createEmptyHooksDir(dependencies = {}) {
  const makeHooksDir =
    dependencies.mkdtempHooksFn ??
    (() => mkdtempAsync(join(tmpdir(), 'worldscript-exact-tree-hooks-')));
  return makeHooksDir();
}

// QNBS-v3: resolved from the trusted repoRoot -- picks up its pinned packageManager, and a .pnpmfile.cjs there is the developer's own code.
function defaultResolveStoreDir(trustedRepoRoot) {
  if (!trustedRepoRoot) return null; // no trusted root to resolve the pinned toolchain from -- fail closed.
  const result = spawnSync('pnpm', ['store', 'path'], {
    cwd: trustedRepoRoot,
    encoding: 'utf8',
    timeout: 10_000,
    shell: process.platform === 'win32',
    env: { ...process.env, COREPACK_ENABLE_NETWORK: '0' },
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export async function createIsolatedWorktree(sha, repoRoot, dependencies = {}) {
  const runGit = dependencies.runBounded ?? runBounded;
  const makeTempDir =
    dependencies.mkdtempFn ?? (() => mkdtempAsync(join(tmpdir(), 'worldscript-exact-tree-')));
  const removeDir = dependencies.rmFn ?? ((p) => rmAsync(p, { recursive: true, force: true }));
  await pruneStaleWorktrees(repoRoot, dependencies);
  let path;
  try {
    path = await makeTempDir();
  } catch {
    return { ok: false, path: undefined };
  }

  let hooksDir;
  try {
    hooksDir = await createEmptyHooksDir(dependencies);
  } catch {
    return { ok: false, path };
  }
  try {
    const result = await runGit(
      'git',
      ['-c', `core.hooksPath=${hooksDir}`, 'worktree', 'add', '--detach', path, sha],
      {
        cwd: repoRoot,
        // QNBS-v3: core.hooksPath disables hooks only, not smudge/clean filters (e.g. LFS) -- nonexistent global/system config makes any referenced filter a no-op.
        env: {
          GIT_CONFIG_GLOBAL: join(hooksDir, 'no-global-config'),
          GIT_CONFIG_SYSTEM: join(hooksDir, 'no-system-config'),
        },
      },
    );
    // QNBS-v3: reported via the return shape, not a throw -- the caller must still clean up this path.
    if (result.interrupted) return { ok: false, path, interrupted: true };
    if (boundedCommandFailed(result)) return { ok: false, path };
    return { ok: true, path };
  } finally {
    try {
      await removeDir(hooksDir);
    } catch {
      // Best-effort: nothing more can be done from here; the directory is under os.tmpdir().
    }
  }
}

// QNBS-v3: fail-closed -- git's own removal failing falls back to a raw sweep plus a metadata prune.
export async function removeIsolatedWorktree(worktreePath, repoRoot, dependencies = {}) {
  if (!worktreePath) return;
  const runGit = dependencies.runBounded ?? runBounded;
  const removeDir = dependencies.rmFn ?? ((path) => rmAsync(path, { recursive: true, force: true }));
  const result = await runGit('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: repoRoot,
  });
  if (boundedCommandFailed(result)) {
    try {
      await removeDir(worktreePath);
    } catch {
      // Best-effort: nothing more can be done from here; the directory is under os.tmpdir().
    }
    await runGit('git', ['worktree', 'prune'], { cwd: repoRoot });
    return;
  }
  // QNBS-v3: git leaves the now-empty mkdtemp-created dir in place after remove -- sweep it too.
  try {
    await removeDir(worktreePath);
  } catch {
    // Best-effort: nothing more can be done from here; the directory is under os.tmpdir().
  }
}

// QNBS-v3: real pnpm install, not a hand-reconstructed symlink graph -- offline, fails to UNKNOWN below.
export async function installDependencies(worktreePath, dependencies = {}) {
  const runPnpm = dependencies.runBounded ?? runBounded;
  const timeoutMs = dependencies.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  const resolveStoreDir = dependencies.resolveStoreDir ?? defaultResolveStoreDir;
  const storeDir =
    dependencies.storeDir !== undefined
      ? dependencies.storeDir
      : await resolveStoreDir(dependencies.trustedRepoRoot);
  if (storeDir === null) return false; // could not establish a trusted store-dir -- fail closed.

  const result = await runPnpm(
    'pnpm',
    [
      'install',
      '--frozen-lockfile',
      '--offline',
      // QNBS-v3: verifying an arbitrary ref must never run that ref's scripts or .pnpmfile.cjs hooks.
      '--ignore-scripts',
      '--ignore-pnpmfile',
      // QNBS-v3: pins every pnpm output path -- CLI flags outrank a target-controlled .npmrc, containing writes.
      '--modules-dir',
      'node_modules',
      '--virtual-store-dir',
      'node_modules/.pnpm',
      '--lockfile-dir',
      worktreePath,
      '--store-dir',
      storeDir,
    ],
    {
      cwd: worktreePath,
      timeoutMs,
      shell: process.platform === 'win32',
      // QNBS-v3: pnpm here is a Corepack shim, which can itself reach the network before --offline applies.
      env: { COREPACK_ENABLE_NETWORK: '0' },
    },
  );
  if (result.interrupted) throw new ExactTreeInterrupted();
  return !boundedCommandFailed(result);
}

// QNBS-v3: precedence shape mirrors aggregateDiagnosticState, kept separate -- different vocabulary.
function aggregateExactTreeState(states) {
  const relevant = states.filter((state) => state !== 'NOT_APPLICABLE');
  if (relevant.length === 0) return 'NOT_APPLICABLE';
  if (relevant.includes('FAIL')) return 'FAIL';
  if (relevant.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

// QNBS-v3: never throws UNKNOWN-worthy failures -- only ExactTreeInterrupted escapes, to stop the whole run.
export async function verifyExactTreeTypecheck(sha, repoRoot = process.cwd(), dependencies = {}) {
  // QNBS-v3: a relative repoRoot would produce ambiguous git-cwd and install-cwd semantics.
  const absoluteRepoRoot = resolve(repoRoot);
  try {
    // QNBS-v3: refuse before any materialization -- tracked node_modules or an escaping symlink must never reach pnpm/tsgo.
    if (!verifyExactTreePreflight(sha, absoluteRepoRoot, dependencies)) return 'UNKNOWN';

    // QNBS-v3: the checked ref may supply source/types/deps but never the compiler that certifies it.
    const computeState = dependencies.computeDependencyState ?? computeDependencyState;
    if (computeState(sha, absoluteRepoRoot, dependencies) !== 'MATCHES') return 'UNKNOWN';

    const created = await createIsolatedWorktree(sha, absoluteRepoRoot, dependencies);
    if (!created.ok) {
      await removeIsolatedWorktree(created.path, absoluteRepoRoot, dependencies);
      if (created.interrupted) throw new ExactTreeInterrupted();
      return 'UNKNOWN';
    }

    try {
      const installed = await installDependencies(created.path, {
        ...dependencies,
        trustedRepoRoot: absoluteRepoRoot,
      });
      if (!installed) return 'UNKNOWN';

      const runDetailed = dependencies.runLocalBinaryDetailed ?? runLocalBinaryDetailed;
      const tsgoArgs = dependencies.tsgoArgs ?? DEFAULT_TSGO_ARGS;
      const tsgoTimeoutMs = dependencies.tsgoTimeoutMs ?? DEFAULT_TSGO_TIMEOUT_MS;
      const result = await runDetailed('tsgo', tsgoArgs, {
        // QNBS-v3: root is the TRUSTED checkout's own tsgo -- cwd stays the isolated tree being analyzed.
        root: absoluteRepoRoot,
        cwd: created.path,
        timeoutMs: tsgoTimeoutMs,
      });
      if (result.interrupted) throw new ExactTreeInterrupted();
      // QNBS-v3: a signal (including an external OOM kill) must yield UNKNOWN, never a false FAIL.
      if (tsgoResultUnknown(result)) return 'UNKNOWN';
      return result.status === 0 ? 'PASS' : 'FAIL';
    } finally {
      await removeIsolatedWorktree(created.path, absoluteRepoRoot, dependencies);
    }
  } catch (error) {
    if (error instanceof ExactTreeInterrupted) throw error;
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

// QNBS-v3: reuses signing-core's bounded, output-capturing runGit -- runBounded can't capture stdout.
export function resolveRef(ref, repoRoot, dependencies = {}) {
  const runGit = dependencies.runGit ?? defaultRunGit;
  const result = runGit(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repoRoot });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const repoRoot = resolve(dependencies.repoRoot ?? process.cwd());
  const refs = argv.length > 0 ? argv : ['HEAD'];
  const shas = [];
  for (const ref of refs) {
    const sha = resolveRef(ref, repoRoot, dependencies);
    if (!sha) {
      console.error(`[verify-exact-tree] could not resolve ref: ${ref}`);
      process.exitCode = 1;
      return;
    }
    shas.push(sha);
  }
  console.log(`[verify-exact-tree] verifying ${shas.length} commit(s) in isolated worktree(s)...`);
  let state;
  try {
    state = await verifyExactTreeForShas(shas, repoRoot, dependencies);
  } catch (error) {
    // QNBS-v3: explicit user intent -- stop here, never continue to another multi-minute verification.
    if (error instanceof ExactTreeInterrupted) {
      console.log('[verify-exact-tree] interrupted; stopping without completing verification.');
      process.exitCode = 130;
      return;
    }
    throw error;
  }
  console.log(`[verify-exact-tree] result: ${state}`);
  if (state === 'UNKNOWN') {
    console.log(
      '[verify-exact-tree] could not be established (offline dependency materialization failed, or a worktree/tsgo step failed); required CI remains authoritative.',
    );
  } else if (state === 'FAIL') {
    console.log('[verify-exact-tree] the exact committed tree does not typecheck in isolation.');
    process.exitCode = 1;
  }
}

// QNBS-v3: guard execution so this module can be imported for testing without running the CLI.
if (isMainModule(process.argv[1], import.meta.url)) await main();
