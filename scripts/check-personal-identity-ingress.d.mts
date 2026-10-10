export type EmailClass = 'missing' | 'github-noreply' | 'unapproved';

export function classifyEmail(email: string): EmailClass;

export function validatePolicy(document: unknown): { ok: boolean };

export function loadPolicy(filePath: string): Record<string, unknown>;

export function defaultPolicyPath(cwd?: string): string;

export function trailerFindings(message: string): string[];

export interface IdentityRecord {
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  message: string;
}

export interface IdentityAudit {
  ok: boolean;
  findings: string[];
}

export function auditIdentityRecord(record: IdentityRecord): IdentityAudit;

export type RunGit = (args: string[]) => string;

export function auditCommit(sha: string, runGit?: RunGit): IdentityAudit;

export function auditTag(sha: string, runGit?: RunGit): IdentityAudit;

export interface RangeAudit {
  ok: boolean;
  audited: number;
  failures: Array<{ sha: string; findings: string[] }>;
}

export function auditRange(base: string, head: string, runGit?: RunGit): RangeAudit;

export function main(argv?: string[], cwd?: string): void;
