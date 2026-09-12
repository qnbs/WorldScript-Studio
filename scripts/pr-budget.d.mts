import type { GitDependencies, PrSizeEvaluation } from './check-pr-size.d.mts';

export interface BudgetDependencies extends GitDependencies {
  env?: NodeJS.ProcessEnv;
}

export interface BudgetBaseResolution {
  ok: boolean;
  base?: string;
  requested?: string;
  source?: 'explicit' | 'pull-request event' | 'live';
  error?: string;
}

export const PR_BUDGET_EXIT_CODES: {
  OK: 0;
  BLOCKED: 1;
  UNRESOLVED_BASE: 2;
};

export function resolveBudgetBase(options?: {
  explicitBase?: string;
  allowLive?: boolean;
  dependencies?: BudgetDependencies;
}): BudgetBaseResolution;

export function evaluateProspectivePrSize(
  base: string,
  head: string,
  dependencies?: BudgetDependencies,
): PrSizeEvaluation;

export function main(argv?: string[]): number;
