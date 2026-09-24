export const root: string;

export interface SuppressionCounts {
  total: number;
  summary: Record<string, number>;
}

export interface SuppressionBaseline {
  total: number;
  byRule: Record<string, number>;
}

export type UpdateDecision =
  | { action: 'WRITE'; baseline: SuppressionBaseline }
  | { action: 'REFUSE'; message: string };

export type GateDecision =
  | { action: 'PASS' }
  | { action: 'FAIL'; reason: string; detail?: string; tip: string };

export function decideUpdateAction(
  current: SuppressionCounts,
  existingBaseline: SuppressionBaseline | null,
): UpdateDecision;

export function decideGateAction(
  current: SuppressionCounts,
  existingBaseline: SuppressionBaseline | null,
): GateDecision;
