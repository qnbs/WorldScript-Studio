export interface RemoteCommit {
  sha: string;
  commit?: {
    message?: string;
    verification?: {
      verified?: boolean;
      reason?: string;
    };
  };
}

export interface RemoteReport {
  sha: string;
  subject: string;
  verified: boolean;
  reason: string;
}

export interface RemoteResult {
  ok: boolean;
  reports: RemoteReport[];
  reason: string;
}

export interface RemoteOptions {
  owner: string;
  repo: string;
  number: number | string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface RemoteCommitRangeOptions {
  owner: string;
  repo: string;
  shas: string[];
  token?: string;
  fetchImpl?: typeof fetch;
}

export function fetchJson(fetchImpl: typeof fetch, url: string, token: string): Promise<unknown>;
export function fetchPullRequestCommits(options: RemoteOptions): Promise<RemoteCommit[]>;
export function safeReport(commit: RemoteCommit): RemoteReport;

export function verifyRemoteCommitReports(commits: RemoteCommit[]): RemoteResult;
export function hasCompleteCommitRange(expectedShas: string[], reports: RemoteReport[]): boolean;
export function verifyRemotePullRequest(options: RemoteOptions): Promise<RemoteResult>;
export function verifyRemoteCommitRange(options: RemoteCommitRangeOptions): Promise<RemoteResult>;
export function verifyRemoteTag(options: {
  owner: string;
  repo: string;
  tag: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<RemoteResult>;
