// QNBS-v3: Keep report and aggregate types aligned with the fail-closed validator.
export interface StrykerMetrics {
  pending: number;
  ignored: number;
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  runtimeErrors: number;
  compileErrors: number;
  totalDetected: number;
  totalUndetected: number;
  totalCovered: number;
  totalValid: number;
  totalInvalid: number;
  totalMutants: number;
}

export interface StrykerModuleReport {
  name: string;
  metrics: StrykerMetrics;
  mutationScore: number;
}

export interface StrykerAggregateResult {
  reports: StrykerModuleReport[];
  totals: StrykerMetrics;
  mutationScore: number;
}

export function readStrykerReports(
  rootDirectory: string,
  selectedModules?: import('./stryker-scope.mjs').StrykerMutationModule[],
): StrykerModuleReport[];
export function aggregateStrykerReports(
  rootDirectory: string,
  selectedModules?: import('./stryker-scope.mjs').StrykerMutationModule[],
): StrykerAggregateResult;
export function formatSummary(result: StrykerAggregateResult): string;
