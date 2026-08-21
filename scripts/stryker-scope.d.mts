export type StrykerRiskTier = 'A' | 'B';

export interface StrykerMutationModule {
  name: string;
  riskTier: StrykerRiskTier;
  mutate: string;
}

export const mutationFiles: string[];
export const mutationModules: StrykerMutationModule[];
export function selectMutationModules(selector?: string): StrykerMutationModule[];
