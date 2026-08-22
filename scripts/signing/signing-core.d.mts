export interface VerificationResult {
  ok: boolean;
  reason: string;
}

export interface RefUpdate {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export interface SigningConfig {
  format: string;
  keyConfigured: boolean;
  gpgProgramConfigured: boolean;
  allowedSignersConfigured: boolean;
  enabled: boolean;
  keyDisplay: string;
  config: Record<string, string>;
}

export function classifyCommitObject(input: {
  objectType: string;
  contents: string;
  verificationStatus: number;
}): VerificationResult;
export function classifyTagVerification(input: {
  objectType: string;
  targetType: string;
  tagVerificationStatus: number;
  commitVerification: VerificationResult;
}): VerificationResult;
export function getSigningConfig(cwd?: string): SigningConfig;
export function hasCommitSignature(commitText: string): boolean;
export function isGitHubCompatibleEmail(email: string): boolean;
export function parseRefUpdate(line: string): RefUpdate | null;
export function selectIntroducedCommits(commits: string[], reachableFromBase: string[]): string[];
export function runSigningProbe(cwd?: string): { ok: boolean; reason?: string; commit?: string };
export function verifyCommitObject(sha: string, cwd?: string): VerificationResult;
export function verifyTagObject(sha: string, cwd?: string): VerificationResult;
