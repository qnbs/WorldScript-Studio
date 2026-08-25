import type { DependencyState } from './dependency-state.d.mts';
import type { WorkingTreeState } from './signing/signing-core.d.mts';

export interface ManualChangeEvidence {
  readonly files: readonly string[];
  readonly rangeResolved: boolean;
  readonly workingTreeState: WorkingTreeState;
  readonly dependencyState: DependencyState;
}

export interface ManualRangeDependencies {
  readonly resolveUpstream?: () => string | null;
  readonly diffNames?: (range: string) => readonly string[] | null;
  readonly workingTreeFiles?: () => readonly string[] | null;
}

export interface ManualEvidenceDependencies extends ManualRangeDependencies {
  readonly resolvePushEvidence?: (input: unknown, cwd: string) => unknown;
  readonly readPrePushEvidenceFile?: (file: string) => unknown;
}

export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean;
export function changedFilesFromManualRange(
  dependencies?: ManualRangeDependencies,
): ManualChangeEvidence;
export function resolveManualEvidence(
  evidenceFile: string | undefined,
  dependencies?: ManualEvidenceDependencies,
): ManualChangeEvidence;
