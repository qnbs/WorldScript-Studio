// QNBS-v3: diagnostic-only dimension, independent of resolvePushEvidence's canonical evidence validity.
export type DependencyState = 'MATCHES' | 'DIVERGED' | 'NOT_APPLICABLE' | 'UNKNOWN';

export function dependencyFiles(root?: string): string[];
export function calculateDependencyFingerprint(root?: string): string;
export function fingerprintPath(root?: string): string;
export function readStoredFingerprint(root?: string): string | null;
export function writeStoredFingerprint(root?: string, fingerprint?: string): void;
export function verifyDependencyState(root?: string): string;
export function main(command?: string): void;

export interface DependencyFilesFromRefDependencies {
  listTree?: (sha: string) => string[] | null;
}

export function dependencyFilesFromRef(
  sha: string,
  root?: string,
  dependencies?: DependencyFilesFromRefDependencies,
): string[] | null;

export interface DependencyFingerprintFromRefDependencies extends DependencyFilesFromRefDependencies {
  dependencyFilesFromRef?: (sha: string) => string[] | null;
  readFileAtRef?: (relativePath: string) => Buffer | null;
}

export function calculateDependencyFingerprintFromRef(
  sha: string,
  root?: string,
  dependencies?: DependencyFingerprintFromRefDependencies,
): string | null;

export interface ComputeDependencyStateDependencies extends DependencyFingerprintFromRefDependencies {
  readStoredFingerprint?: () => string | null;
  calculateDependencyFingerprintFromRef?: (sha: string) => string | null;
}

export function computeDependencyState(
  sha: string,
  root?: string,
  dependencies?: ComputeDependencyStateDependencies,
): DependencyState;
