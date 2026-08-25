export type ChangeKind =
  | 'NO_CHANGES'
  | 'DOCS_ONLY'
  | 'WORKFLOW_ONLY'
  | 'NON_CODE_ONLY'
  | 'RUST_TAURI'
  | 'TOOLING'
  | 'TEST_ONLY'
  | 'TYPESCRIPT_APPLICATION'
  | 'DEPENDENCY_TOOLCHAIN'
  | 'BUILD_CONFIGURATION'
  | 'AMBIGUOUS'
  | 'MIXED';

export interface ChangeClassification {
  readonly kind: ChangeKind;
  readonly categories: readonly string[];
  readonly files: readonly string[];
}

export function classifyFile(file: string): string;
export function classifyChangedFiles(files: readonly string[]): ChangeClassification;
export function requiresTypecheck(
  classification: ChangeClassification,
  options?: { readonly full?: boolean },
): boolean;
export function manualAdmissionNeedsFullValidation(rangeResolved: boolean): boolean;
