/**
 * InferenceGateway — Unified AI inference entry point for the ProForge pipeline.
 * QNBS-v3: Single choke point for generate/embed/model-list — injectable for testing,
 * delegates to aiProviderService which already handles dedup, fallback chain, retry, and policy.
 */

import type { AiCreativity } from '../../types';
import type { AIRequestOptions } from '../aiProviderService';
import { generateText } from '../aiProviderService';

// ---------------------------------------------------------------------------
// Request / Result types
// ---------------------------------------------------------------------------

export interface GenerateRequest {
  prompt: string;
  /** Defaults to 'Balanced' when omitted. */
  creativity?: AiCreativity;
  options: AIRequestOptions;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  /** True when the underlying provider fell back to a stub/local model. */
  isFallback: boolean;
}

export interface EmbedRequest {
  text: string;
  signal?: AbortSignal;
}

export interface EmbedResult {
  vector: number[];
}

export interface GatewayHealth {
  status: 'ok' | 'degraded' | 'unavailable';
  provider: string;
  latencyMs?: number;
}

export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  isLocal: boolean;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface InferenceGateway {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  modelList(): Promise<ModelInfo[]>;
  healthCheck(): Promise<GatewayHealth>;
}

// ---------------------------------------------------------------------------
// Default implementation — thin wrapper over aiProviderService
// ---------------------------------------------------------------------------

export class DefaultInferenceGateway implements InferenceGateway {
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const { prompt, creativity = 'Balanced', options } = request;

    // aiProviderService.generateText already handles: dedup, fallback chain,
    // withTransientRetry (2 attempts), assertCloudAiAllowed policy gate.
    const text = await generateText(prompt, creativity, options);

    return {
      text,
      model: options.model,
      provider: options.provider,
      isFallback: false,
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    // QNBS-v3: Lazy import — localEmbeddingService loads ONNX worker on first call.
    // embedText does not accept a signal; AbortSignal support is a Phase 3 addition.
    const { embedText } = await import('./localEmbeddingService');
    const f32 = await embedText(request.text);
    return { vector: Array.from(f32) };
  }

  async modelList(): Promise<ModelInfo[]> {
    // QNBS-v3: Enumerate cloud + local models. Local models are resolved from ai-core catalogs.
    const { WEBLLM_SUPPORTED_MODELS, ONNX_SUPPORTED_MODELS } = await import('@domain/ai-core');
    const cloud: ModelInfo[] = [
      {
        id: 'gemini-2.0-flash',
        provider: 'gemini',
        displayName: 'Gemini 2.0 Flash',
        isLocal: false,
      },
      { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o', isLocal: false },
    ];
    const local: ModelInfo[] = [
      ...WEBLLM_SUPPORTED_MODELS.map((m) => ({
        id: m.id,
        provider: 'webllm',
        displayName: m.label,
        isLocal: true,
      })),
      ...ONNX_SUPPORTED_MODELS.map((m) => ({
        id: m.id,
        provider: 'onnx',
        displayName: m.label,
        isLocal: true,
      })),
    ];
    return [...cloud, ...local];
  }

  async healthCheck(): Promise<GatewayHealth> {
    // QNBS-v3: Lightweight latency probe — measure embedding inference time as proxy for health.
    const start = performance.now();
    try {
      const { embedText } = await import('./localEmbeddingService');
      await embedText('health-check-probe');
      return {
        status: 'ok',
        provider: 'local-embedding',
        latencyMs: Math.round(performance.now() - start),
      };
    } catch {
      return { status: 'degraded', provider: 'local-embedding' };
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (used when no gateway injected via context)
// ---------------------------------------------------------------------------

export const inferenceGateway: InferenceGateway = new DefaultInferenceGateway();

export function createInferenceGateway(): InferenceGateway {
  return new DefaultInferenceGateway();
}
