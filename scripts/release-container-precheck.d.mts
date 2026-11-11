export const REPOSITORY: string;
export const BUILD_CHECK_WORKFLOW: string;
export const BUILD_CHECK_JOB: string;
export const DEFAULT_BRANCH: string;
export const TRUSTED_EVENTS: readonly string[];

export interface PrecheckRun {
  id: number;
  head_sha: string;
  head_branch: string;
  event: string;
  path: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string;
  html_url?: string;
}

export interface PrecheckJob {
  name: string;
  conclusion: string | null;
}

export function latestTrustedRun(sha: string, runs: PrecheckRun[] | null): PrecheckRun | null;

export function classifyContainerPrecheck(input: {
  sha: string;
  runs: PrecheckRun[] | null;
  /** The runs API's total_count for the same query; any mismatch with runs.length fails. */
  totalCount: number | null;
  jobsByRun: Record<string, PrecheckJob[] | null> | null;
}): { ok: boolean; reason: string; runId: number | null; url: string | null };
