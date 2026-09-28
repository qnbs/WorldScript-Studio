export const MANIFEST_PATH: string;
export const VERIFIER_PATH: string;
export const TRUST_WORKFLOW_PATH: string;
export const EVALUATOR_ENTRY: string;
export const EVALUATOR_PATHS: readonly string[];
export const PROTECTED_PATHS: readonly string[];

export interface RawChange {
  oldMode: string;
  newMode: string;
  oldBlob: string;
  newBlob: string;
  status: string;
  path: string;
}

export interface ProtectedTransition {
  path: string;
  from: string;
  to: string;
}

export function sha256(bytes: string | Uint8Array): string;
export function parseRawDiff(raw: string | Uint8Array): RawChange[];
export function parseManifest(
  text: string,
): { transitions: ProtectedTransition[]; error?: undefined } | { error: string };
export function evaluatorImportClosure(
  readHeadFile: (path: string) => string | null,
  entry?: string,
): { files: string[]; violations: string[] };
export function evaluateProtectedTransitions(input: {
  changes: RawChange[];
  baseManifestText: string | null;
  readBlob: (blob: string) => Uint8Array;
  readHeadFile: (path: string) => string | null;
}): string[];
export function verifyProtectedTransitions(input: {
  baseSha: string | undefined;
  headSha: string | undefined;
  cwd?: string;
}): string[];
