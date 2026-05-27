/**
 * AI Constants — consolidated provider/creativity/backend constants.
 * QNBS-v3: Single home for small constant files that had no reason to be separate modules.
 */

import type { AIProvider, AiCreativity, LocalBackendPreset } from '../../types';

export const CREATIVITY_TO_TEMPERATURE: Record<AiCreativity, number> = {
  Focused: 0.2,
  Balanced: 0.7,
  Imaginative: 1.0,
};

export const LOCAL_BACKEND_PRESET_DEFAULT_URL: Record<LocalBackendPreset, string> = {
  ollama_default: 'http://localhost:11434',
  lm_studio: 'http://localhost:1234',
  vllm: 'http://localhost:8000',
  custom: 'http://localhost:11434',
};

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
