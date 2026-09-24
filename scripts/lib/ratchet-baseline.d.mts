export interface RatchetCounts {
  total: number;
  summary: Record<string, number>;
}

export interface BaselineVerdict {
  ok: boolean;
  reason: string;
  detail?: string;
}

export function evaluateBaseline(
  audit: RatchetCounts,
  baseline: RatchetCounts | null | undefined,
): BaselineVerdict;

export function hasValidCounts(candidate: unknown): candidate is RatchetCounts;
export function isValidCount(value: unknown): value is number;
export function sumSummary(summary: Record<string, number>): number;
