import type { AIProvider } from '../../types';

/** Provider, die über die Vercel-AI-Orchestrierung (`streamText` / `useCompletion`) laufen. */
export const ORCHESTRATION_READY_PROVIDERS = [
  'gemini',
  'openai',
  'ollama',
] as const satisfies readonly AIProvider[];

export function isOrchestrationReadyProvider(p: AIProvider): boolean {
  return (ORCHESTRATION_READY_PROVIDERS as readonly string[]).includes(p);
}
