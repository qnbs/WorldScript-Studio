export interface StrykerMetrics {
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

export function readStrykerReports(rootDirectory: string): StrykerModuleReport[];
export function aggregateStrykerReports(rootDirectory: string): StrykerAggregateResult;
export function formatSummary(result: StrykerAggregateResult): string;
