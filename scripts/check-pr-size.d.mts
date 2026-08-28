export interface GitDependencies {
  spawnSync?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8' },
  ) => { status: number | null; stdout: string; stderr: string; error?: Error };
  readFileSync?: (path: string, encoding: 'utf8') => string;
  existsSync?: (path: string) => boolean;
  writeFileSync?: (path: string, content: string) => void;
  unlinkSync?: (path: string) => void;
  env?: NodeJS.ProcessEnv;
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

export interface SupplementalLineAllowance {
  path: string;
  maxMeaningfulLines: number;
}

export interface PrSizeException {
  id: string;
  repository: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  maxFiles: number;
  maxCommits: number;
  maxNonExemptMeaningfulLines: number;
  supplementalLineAllowances: SupplementalLineAllowance[];
  allowedPaths: string[];
  reason: string;
}

export function computeNonExemptMeaningfulLines(
  rows: NumstatRow[],
  exception?: PrSizeException,
): number;

export function computeSupplementalReportLines(
  rows: NumstatRow[],
  exception: PrSizeException,
): Record<string, number>;

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
  nonExemptLineCount?: number;
  supplementalReportLines?: Record<string, number>;
  exception?: {
    applied: boolean;
    id?: string;
    identityMatch: boolean;
    pathScopeMatch: boolean;
    baseGoverned: boolean;
  };
  severity?: SizeSeverity;
  report?: string;
}

export function evaluatePrSize(
  base: string,
  head: string,
  dependencies?: GitDependencies,
): PrSizeEvaluation;

export function main(): void;
