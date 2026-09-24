export const root: string;

export interface SuppressionCounts {
  total: number;
  summary: Record<string, number>;
}

export interface SuppressionBaseline {
  total: number;
  byRule: Record<string, number>;
}

export interface UpdateDecision {
  action: 'WRITE' | 'REFUSE';
  baseline?: SuppressionBaseline;
  message?: string;
}

export interface GateDecision {
  action: 'PASS' | 'FAIL';
  reason?: string;
  detail?: string;
  tip?: string;
}

export function decideUpdateAction(
  current: SuppressionCounts,
  existingBaseline: SuppressionBaseline | undefined,
): UpdateDecision;

export function decideGateAction(
  current: SuppressionCounts,
  existingBaseline: SuppressionBaseline | undefined,
): GateDecision;

export function withUpdateLock<T>(baselinePath: string, fn: () => T): T;

export function writeBaselineAtomic(baselinePath: string, baseline: SuppressionBaseline): void;
