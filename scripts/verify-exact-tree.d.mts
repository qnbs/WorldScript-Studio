import type { GitOptions, GitResult } from './signing/signing-core.d.mts';

// QNBS-v3: absolute correctness check, not a comparison -- distinct vocabulary from WorkingTreeState.
export type ExactTreeState = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'UNKNOWN';

export interface VerifyExactTreeDependencies {
  runBounded?: (
    command: string,
    args: string[],
    options?: GitOptions & { timeoutMs?: number },
  ) => Promise<GitResult & { timedOut: boolean; interrupted: boolean }>;
  runLocalBinaryDetailed?: (
    binary: string,
    args: string[],
    options?: { root?: string; cwd?: string; timeoutMs?: number },
  ) => Promise<GitResult & { timedOut: boolean; interrupted: boolean }>;
  mkdtempFn?: () => Promise<string>;
  rmFn?: (path: string) => Promise<void>;
  symlinkFn?: (target: string, linkPath: string) => void;
  dependencyStateForRef?: (sha: string) => string;
  nodeModulesSource?: string;
  tsgoArgs?: string[];
  runGitSync?: (args: string[]) => { status: number | null; stdout: string };
}

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

export function main(argv?: string[]): Promise<void>;
