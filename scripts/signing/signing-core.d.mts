export interface VerificationResult {
  ok: boolean;
  reason: string;
}

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: Error;
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
  allowedSignersFile: string;
  config: Record<string, string>;
}

export interface GitOptions {
  cwd?: string;
  input?: string;
}

export interface OutgoingReport {
  sha: string;
  subject: string;
  verification: VerificationResult;
}

export interface OutgoingResult {
  ok: boolean;
  reports?: OutgoingReport[];
  reason: string;
}

export function runGit(args: string[], options?: GitOptions): GitResult;
export function gitOutput(args: string[], options?: GitOptions): string;
export function isSha(value: unknown): boolean;
export function isZeroSha(value: unknown): boolean;
export function getRepositoryRoot(cwd?: string): string | null;
export function getGitDirectory(cwd?: string): string | null;
export function getConfig(cwd?: string): Record<string, string>;
export function getIdentity(cwd?: string): { name: string; email: string };
export function getUnsafeOverrides(env?: Record<string, string | undefined>): string[];
export function isSigningEnabled(config: Record<string, string>): boolean;

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
export function normalizePrePushUpdates(input: string | string[] | RefUpdate[]): RefUpdate[];
export function serializePrePushEvidence(input: string | string[] | RefUpdate[]): string;
export function parsePrePushEvidence(serialized: string): RefUpdate[];
export function readPrePushEvidenceFile(file: string): RefUpdate[];
export function writePrePushEvidenceFile(
  file: string,
  input: string | string[] | RefUpdate[],
): void;
export interface PushEvidenceUpdate extends RefUpdate {
  base?: string;
  disposition: 'DELETED' | 'TAG' | 'NEW_BRANCH' | 'UPDATED';
}
export interface PushEvidence {
  updates: PushEvidenceUpdate[];
  changedFiles: string[];
  evidenceState: 'RESOLVED' | 'INVALID';
  pathEvidenceState: 'COMPLETE' | 'PARTIAL';
  reason?: string;
}
export function resolvePushEvidence(
  input: string | string[] | RefUpdate[],
  cwd?: string,
  dependencies?: {
    commitExists?: (sha: string) => boolean;
    objectExists?: (sha: string) => boolean;
    changedFilesBetween?: (base: string, head: string) => string[];
  },
): PushEvidence;
export function selectIntroducedCommits(commits: string[], reachableFromBase: string[]): string[];
export function runSigningProbe(cwd?: string): { ok: boolean; reason?: string; commit?: string };
export function verifyCommitObject(sha: string, cwd?: string): VerificationResult;
export function commitSubject(sha: string, cwd?: string): string;
export function commitsInRange(range: string, cwd?: string): string[];
export function verifyCommitRange(
  range: string,
  cwd?: string,
): Array<{ sha: string; subject: string; verification: VerificationResult }>;
export function pushEventRange(payload: { before?: string; after?: string }): {
  before: string;
  after: string;
};
export function pushCommitShas(
  payload: { before?: string; after?: string },
  cwd?: string,
  rangeResolver?: (range: string, cwd?: string) => string[],
): string[];
export function parseAnnotatedTag(
  sha: string,
  cwd?: string,
):
  | { objectType: 'commit'; target: string }
  | { objectType: 'tag'; target: string; targetType: string }
  | null;
export function verifyTagObject(sha: string, cwd?: string): VerificationResult;
export function remoteTrackingBases(remote: string, remoteRef: string, cwd?: string): string[];
export function outgoingBaseShas(update: RefUpdate, fallbackBases: string[]): string[];
export function introducedCommits(update: RefUpdate, remote: string, cwd?: string): string[];
export function safeConfigSummary(cwd?: string): {
  signing: {
    format: string;
    enabled: boolean;
    keyConfigured: boolean;
    keyDisplay: string;
    gpgProgramConfigured: boolean;
    allowedSignersConfigured: boolean;
  };
  identity: { nameConfigured: boolean; emailConfigured: boolean; githubCompatible: boolean };
  hooks: { pathConfigured: boolean; directory: string; hooksInstalled: boolean };
  unsafeOverrides: string[];
};
export function verifyOutgoingUpdates(
  input: string | string[] | RefUpdate[],
  remote: string,
  cwd?: string,
  dependencies?: {
    verifyCommitObject?: (sha: string) => VerificationResult;
    verifyTagObject?: (sha: string) => VerificationResult;
    introducedCommits?: (update: RefUpdate) => string[];
  },
): OutgoingResult;
