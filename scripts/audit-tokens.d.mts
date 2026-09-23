export const root: string;

export interface AuditViolation {
  line: number;
  column: number;
  rule: string;
  message: string;
  match: string;
}

export interface AuditResult {
  byFile: Record<string, AuditViolation[]>;
  summary: Record<string, number>;
  total: number;
}

export interface AuditBaseline {
  total: number;
  summary: Record<string, number>;
  updatedAt?: string;
}

export interface BaselineVerdict {
  ok: boolean;
  reason: string;
  detail?: string;
}

export function getTrackedSourceFiles(repoRoot?: string): string[];
export function resolveAuditableFiles(candidateFiles: string[], repoRoot?: string): string[];
export function findViolations(files: string[], repoRoot?: string): AuditResult;
export function evaluateBaseline(
  audit: Pick<AuditResult, 'summary' | 'total'>,
  baseline: AuditBaseline | null,
): BaselineVerdict;
export function isDirectExecution(argv1: string | undefined, moduleUrl: string): boolean;
