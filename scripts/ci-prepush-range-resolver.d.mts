export interface ManualChangeEvidence {
  readonly files: readonly string[];
  readonly rangeResolved: boolean;
}

export interface ManualRangeDependencies {
  readonly resolveUpstream?: () => string | null;
  readonly diffNames?: (range: string) => readonly string[] | null;
  readonly workingTreeFiles?: () => readonly string[];
}

export interface ManualEvidenceDependencies extends ManualRangeDependencies {
  readonly resolvePushEvidence?: (input: unknown, cwd: string) => unknown;
  readonly readPrePushEvidenceFile?: (file: string) => unknown;
}

export function changedFilesFromManualRange(
  dependencies?: ManualRangeDependencies,
): ManualChangeEvidence;
export function resolveManualEvidence(
  evidenceFile: string | undefined,
  dependencies?: ManualEvidenceDependencies,
): ManualChangeEvidence;
