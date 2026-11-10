export const REPOSITORY: string;
export const BUILD_CHECK_WORKFLOW: string;
export const BUILD_CHECK_JOB: string;

export interface PrecheckRun {
  id: number;
  head_sha: string;
  path: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url?: string;
}

export interface PrecheckJob {
  name: string;
  conclusion: string | null;
}

export function classifyContainerPrecheck(input: {
  sha: string;
  runs: PrecheckRun[] | null;
  jobsByRun: Record<string, PrecheckJob[] | null> | null;
}): { ok: boolean; reason: string; runId: number | null; url: string | null };
