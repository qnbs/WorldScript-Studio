export type ChangeCategory =
  | 'DOCS'
  | 'WORKFLOW'
  | 'RUST_TAURI'
  | 'DESKTOP_NATIVE_CONTRACT'
  | 'TEST_ONLY'
  | 'TOOLING'
  | 'DEPENDENCY_TOOLCHAIN'
  | 'BUILD_CONFIGURATION'
  | 'TYPESCRIPT_APPLICATION'
  | 'UNKNOWN';

export type ChangeKind =
  | 'NO_CHANGES'
  | 'DOCS_ONLY'
  | 'WORKFLOW_ONLY'
  | 'NON_CODE_ONLY'
  | ChangeCategory
  | 'MIXED'
  | 'AMBIGUOUS';

export interface ChangeClassification {
  kind: ChangeKind;
  categories: ChangeCategory[];
  files: string[];
}

export interface ProcessResult {
  status: number | null;
  signal: string | null;
  timedOut?: boolean;
}

export function classifyFile(file: string): ChangeCategory;
export function isWorkflowPolicyFile(file: string): boolean;
export function isI18nPolicyFile(file: string): boolean;
export function classifyChangedFiles(files: string[]): ChangeClassification;
export function requiresTypecheck(
  classification: ChangeClassification,
  options?: { full?: boolean },
): boolean;
export function classifyProcessResult(
  result: ProcessResult,
): 'PASS' | 'FAIL' | 'LOCAL_RESOURCE_FAILURE';
export function classifySignatureResult(verified: boolean): 'PASS' | 'FAIL';
