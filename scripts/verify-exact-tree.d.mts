import type { BoundedResult } from './hooks/shared.d.mts';
import type { GitOptions, GitResult } from './signing/signing-core.d.mts';

// QNBS-v3: absolute correctness check, not a comparison -- distinct vocabulary from WorkingTreeState.
export type ExactTreeState = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'UNKNOWN';

export interface VerifyExactTreeDependencies {
  runBounded?: (
    command: string,
    args: string[],
    options?: {
      timeoutMs?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      input?: string;
      shell?: boolean;
      root?: string;
      detached?: boolean;
    },
  ) => Promise<BoundedResult>;
  runLocalBinaryDetailed?: (
    binary: string,
    args: string[],
    options?: { root?: string; cwd?: string; timeoutMs?: number },
  ) => Promise<BoundedResult>;
  // QNBS-v3: a distinct, pre-existing (#494) synchronous/output-capturing wrapper -- not BoundedResult.
  runGit?: (args: string[], options?: GitOptions) => GitResult;
  mkdtempFn?: () => Promise<string>;
  // QNBS-v3: a separate temp dir authority from mkdtempFn -- distinct lifecycle (hooks dir vs. worktree dir).
  mkdtempHooksFn?: () => Promise<string>;
  rmFn?: (path: string) => Promise<void>;
  installTimeoutMs?: number;
  tsgoArgs?: string[];
  tsgoTimeoutMs?: number;
  repoRoot?: string;
  // QNBS-v3: reuses dependency-state.mjs's git-tree enumeration authority -- not a second parser.
  listTreeFiles?: (sha: string, cwd: string) => string[] | null;
}

export function createIsolatedWorktree(
  sha: string,
  repoRoot: string,
  dependencies?: VerifyExactTreeDependencies,
): Promise<{ ok: boolean; path: string | undefined }>;

export function removeIsolatedWorktree(
  worktreePath: string | undefined,
  repoRoot: string,
  dependencies?: VerifyExactTreeDependencies,
): Promise<void>;

export function installDependencies(
  worktreePath: string,
  dependencies?: VerifyExactTreeDependencies,
): Promise<boolean>;

export function verifyExactTreeTypecheck(
  sha: string,
  repoRoot?: string,
  dependencies?: VerifyExactTreeDependencies,
): Promise<ExactTreeState>;

export function verifyExactTreeForShas(
  shas: string[],
  repoRoot?: string,
  dependencies?: VerifyExactTreeDependencies,
): Promise<ExactTreeState>;

export function resolveRef(
  ref: string,
  repoRoot: string,
  dependencies?: VerifyExactTreeDependencies,
): string | null;

export function main(argv?: string[], dependencies?: VerifyExactTreeDependencies): Promise<void>;
