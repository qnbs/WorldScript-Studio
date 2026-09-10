export function isReferencedByPrLabel(prNumber: number, text: string): boolean;

export interface CheckPrChangelogReferenceInput {
  prNumber: number;
  prTitle: string | undefined | null;
  changelog: string | undefined | null;
}

export type CheckPrChangelogReferenceReason = 'not-governed' | 'referenced' | 'missing-reference';

export interface CheckPrChangelogReferenceResult {
  ok: boolean;
  reason: CheckPrChangelogReferenceReason;
}

export function checkPrChangelogReference(
  input: CheckPrChangelogReferenceInput,
): CheckPrChangelogReferenceResult;
