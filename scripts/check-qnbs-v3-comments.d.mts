export interface QnbsViolation {
  line: number;
  reason: string;
}

export interface QnbsFileViolation extends QnbsViolation {
  file: string;
}

export interface QnbsCheckResult {
  ok: boolean;
  failedClosed: boolean;
  violations: QnbsFileViolation[];
}

export function extensionOf(filePath: string): string;
export function isGovernedPath(filePath: string): boolean;
export function isWorkflowYamlPath(filePath: string): boolean;
export function commentStyleFor(filePath: string): 'line-slash' | 'line-hash' | 'block-css' | null;
export function parseAddedLineNumbers(diffText: string): Set<number>;
export function findLineCommentViolations(
  lines: string[],
  addedLineNumbers: Set<number>,
  token: string,
): QnbsViolation[];
export function findBlockCommentViolations(
  lines: string[],
  addedLineNumbers: Set<number>,
): QnbsViolation[];
export function findYamlConfigMarkerViolations(
  lines: string[],
  addedLineNumbers: Set<number>,
  filePath: string,
): QnbsViolation[];
export function checkFileContent(
  filePath: string,
  currentContent: string,
  diffText: string,
): QnbsViolation[];
export function resolveUpstreamRef(cwd: string): string | null;
export function runCheck(options?: {
  mode: 'staged' | 'range';
  ref?: string;
  cwd?: string;
}): QnbsCheckResult;
