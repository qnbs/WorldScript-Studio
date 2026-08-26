export interface GitDependencies {
  spawnSync?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8' },
  ) => { status: number | null; stdout: string; stderr: string; error?: Error };
}

export function getChangedFilesNumstat(
  base: string,
  head: string,
  dependencies?: GitDependencies,
): string | null;

export function getCommitCount(
  base: string,
  head: string,
  dependencies?: GitDependencies,
): number | null;

export interface NumstatRow {
  path: string;
  added: number;
  removed: number;
}

export function parseNumstat(numstatOutput: string): NumstatRow[];

export function computeMeaningfulLines(rows: NumstatRow[]): number;

export function computeGovernedFileCount(rows: NumstatRow[]): number;

export function isAllDocs(rows: NumstatRow[]): boolean;

export interface SizeTierLimits {
  files: number;
  lines: number;
  commits: number;
}

export type SizeTier = 'ok' | 'target' | 'hard' | 'docsGovernance' | 'absolute';

export interface SizeSeverity {
  tier: SizeTier;
  blocking: boolean;
  limits: SizeTierLimits;
}

export function selectSeverity(input: {
  fileCount: number;
  lineCount: number;
  commitCount: number;
  allDocs: boolean;
}): SizeSeverity;

export function formatReport(input: {
  fileCount: number;
  totalFileCount: number;
  lineCount: number;
  commitCount: number;
  allDocs: boolean;
  severity: SizeSeverity;
}): string;

export interface PrSizeEvaluation {
  ok: boolean;
  error?: string;
  fileCount?: number;
  totalFileCount?: number;
  lineCount?: number;
  commitCount?: number;
  allDocs?: boolean;
  severity?: SizeSeverity;
  report?: string;
}

export function evaluatePrSize(
  base: string,
  head: string,
  dependencies?: GitDependencies,
): PrSizeEvaluation;

export function main(): void;
