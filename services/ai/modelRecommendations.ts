/** QNBS-v3: Kuratierte Hinweise — keine Download-/Pflicht-Modelle; Nutzer prüft Namen in der jeweiligen GUI (Ollama/LM Studio). */

import type { AiTaskType, DeviceHealthReport } from './deviceHealthService';

export const RECOMMENDED_OLLAMA_MODEL_IDS = [
  'qwen3:8b',
  'llama3.3',
  'mistral',
  'gemma3',
  'deepseek-r1:7b',
] as const;

export const RECOMMENDED_OPENAI_COMPAT_CLOUD_HINT =
  'OpenRouter/Groq/Azure OpenAI: Basis-URL + Modell-ID wie beim Anbieter dokumentiert (Stand 2026 — Preise/SLAs auf der Anbieterseite prüfen).';

// QNBS-v3: Eco-mode model: smallest viable ONNX model for battery-constrained devices (2025 update).
export const ECO_TEXT_GEN_MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct';

export interface ModelRecommendationSet {
  /** Best WebLLM model for the current device; undefined when WebGPU unavailable. */
  webllm?: string;
  /** ONNX/Transformers.js fallback model. */
  onnx?: string;
  /** Lightweight Transformers.js CPU model. */
  transformers?: string;
}

/**
 * QNBS-v3: Device-adaptive model selection — maps VRAM tier × task type to concrete model IDs.
 *          Eco mode always returns the smallest available model regardless of VRAM.
 */
export function getModelRecommendationForTask(
  task: AiTaskType,
  report: DeviceHealthReport,
  ecoMode = false,
): ModelRecommendationSet {
  if (task === 'embedding') {
    return {
      onnx: 'Xenova/all-MiniLM-L6-v2',
      transformers: 'Xenova/all-MiniLM-L6-v2',
    };
  }

  if (task === 'rag') {
    // QNBS-v3: SmolLM2-135M replaces DistilGPT-2 as the standard tiny ONNX RAG model (2025).
    return {
      onnx: 'HuggingFaceTB/SmolLM2-135M-Instruct',
      transformers: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    };
  }

  // text-gen: VRAM tier determines WebLLM model; eco mode overrides to smallest
  if (ecoMode) {
    return {
      onnx: ECO_TEXT_GEN_MODEL,
      transformers: ECO_TEXT_GEN_MODEL,
    };
  }

  const vramTier = report.gpuVramTier;

  if (vramTier === 'none') {
    return {
      onnx: 'HuggingFaceTB/SmolLM2-135M-Instruct',
      transformers: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    };
  }

  // QNBS-v3: Updated to 2025 model releases: Phi-4 Mini, Gemma 3, Llama 3.3.
  const webllmModel =
    vramTier === 'high'
      ? 'Phi-4-mini-instruct-q4f16_1-MLC'
      : vramTier === 'medium'
        ? 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
        : 'gemma-3-1b-it-q4f16_1-MLC'; // 'low'

  const onnxModel =
    vramTier === 'high'
      ? 'Xenova/Qwen2.5-1.5B-Instruct'
      : vramTier === 'medium'
        ? 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'
        : 'HuggingFaceTB/SmolLM2-135M-Instruct';

  return { webllm: webllmModel, onnx: onnxModel, transformers: onnxModel };
}

/**
 * QNBS-v3: Lightweight round-trip probe to estimate Ollama server latency.
 *          Returns Infinity when Ollama is unreachable (network error or non-200 response).
 */
export async function getProviderSpeedEstimate(ollamaBaseUrl: string): Promise<number> {
  const start = performance.now();
  try {
    const res = await fetch(`${ollamaBaseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return Number.POSITIVE_INFINITY;
    return performance.now() - start;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
