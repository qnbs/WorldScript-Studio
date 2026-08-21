export type StrykerRiskTier = 'A' | 'B';

// QNBS-v3: Type the scope registry and selectors consumed by the CI matrix.
export interface StrykerMutationModule {
  name: string;
  riskTier: StrykerRiskTier;
  mutate: string;
}

export const mutationFiles: string[];
export const mutationModules: StrykerMutationModule[];
export function selectMutationModules(selector?: string): StrykerMutationModule[];
