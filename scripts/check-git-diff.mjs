import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function runGit(args, env = {}) {
  return spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function diagnostics(result) {
  return [result.stdout, result.stderr]
    .filter((value) => value?.trim())
    .flatMap((value) => value.trim().split(/\r?\n/));
}

function runGitCheck(args, label, env = {}) {
  const result = runGit(args, env);
  if (result.status === 0) return true;
  const messages = diagnostics(result);
  console.error(`${label} failed${messages.length > 0 ? `:\n${messages.join('\n')}` : ''}`);
  return false;
}

function withTemporaryIndex(callback) {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-git-index-'));
  const index = join(directory, 'index');
  const objectDirectory = join(directory, 'objects');
  mkdirSync(objectDirectory);
  const objectStore = runGit(['rev-parse', '--git-path', 'objects']);
  if (objectStore.status !== 0) throw new Error('Git object store cannot be resolved');
  const env = {
    GIT_INDEX_FILE: index,
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: objectStore.stdout.trim(),
  };
  try {
    return callback(env);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// QNBS-v3: ask Git to evaluate untracked content through an isolated index instead of reimplementing diff semantics.
export function checkUntrackedFile(filePath) {
  if (!lstatSync(filePath).isFile()) return [];
  const relativePath = relative(process.cwd(), filePath);
  return withTemporaryIndex((env) => {
    const initial = runGit(['read-tree', '--empty'], env);
    if (initial.status !== 0) return diagnostics(initial);
    const add = runGit(['add', '--', relativePath], env);
    if (add.status !== 0) return diagnostics(add);
    return diagnostics(runGit(['diff', '--cached', '--check', '--', relativePath], env));
  });
}

function checkWorkingTree() {
  return withTemporaryIndex((env) => {
    if (!runGitCheck(['read-tree', 'HEAD'], 'temporary index initialization', env)) return false;
    if (
      !runGitCheck(
        [
          'add',
          '-A',
          '--',
          '.',
          ':(exclude).worktrees/**',
          ':(exclude)recovery-artifacts/**',
          ':(exclude).tmp-git-index-*/**',
          ':(exclude).tmp-prepush-tree-*/**',
        ],
        'temporary index staging',
        env,
      )
    )
      return false;
    return runGitCheck(['diff', '--cached', '--check'], 'working-tree diff check', env);
  });
}

function runCheck() {
  if (!checkWorkingTree()) process.exit(1);

  const explicitRanges = (process.env.WORLD_SCRIPT_PREPUSH_DIFF_RANGES ?? '')
    .split('\n')
    .map((range) => range.trim())
    .filter(Boolean);
  const hasExplicitRanges = Object.hasOwn(process.env, 'WORLD_SCRIPT_PREPUSH_DIFF_RANGES');
  // QNBS-v3: compare exact remote and local tips for outgoing diff integrity.
  const ranges = hasExplicitRanges
    ? explicitRanges
    : (process.env.WORLD_SCRIPT_PREPUSH_UPDATES ?? '')
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 4)
        .filter(([, localSha]) => !/^0+$/.test(localSha))
        .map(([, localSha, , remoteSha]) => {
          if (!/^0+$/.test(remoteSha)) return `${remoteSha}..${localSha}`;
          const originMain = runGit(['rev-parse', 'origin/main']);
          if (originMain.status !== 0) throw new Error('origin/main cannot be resolved');
          return `${originMain.stdout.trim()}..${localSha}`;
        });
  for (const range of ranges) {
    if (!/^[0-9a-f]+\.\.[0-9a-f]+$/i.test(range)) {
      console.error(`outgoing diff check received an invalid range: ${range}`);
      process.exit(1);
    }
    if (!runGitCheck(['diff', '--check', range], 'outgoing diff check')) process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCheck();
  } catch {
    process.exit(1);
  }
}
