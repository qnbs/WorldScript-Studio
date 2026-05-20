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

// QNBS-v3: webllm/onnx/transformers run entirely in-browser without HTTP — stay in localAiFacade path.
export const LOCAL_INFERENCE_PROVIDERS = [
  'webllm',
  'onnx',
  'transformers',
] as const satisfies readonly AIProvider[];

export type LocalInferenceProvider = (typeof LOCAL_INFERENCE_PROVIDERS)[number];

export function isLocalInferenceProvider(p: AIProvider): boolean {
  return (LOCAL_INFERENCE_PROVIDERS as readonly string[]).includes(p);
}
