/**
 * Node InferenceGateway — implements the InferenceGateway contract for non-browser runtimes (MCP).
 * QNBS-v3: Talks to Google Gemini via `@google/genai` directly, bypassing the browser-only AI policy
 * layer (aiProviderService). API key comes from an explicit env var — never bundled, never logged.
 */

import { GoogleGenAI } from '@google/genai';
import type {
  EmbedRequest,
  EmbedResult,
  GatewayHealth,
  GenerateRequest,
  GenerateResult,
  InferenceGateway,
  ModelInfo,
} from '../../ai/inferenceGateway';

const CREATIVITY_TEMPERATURE: Record<string, number> = {
  Focused: 0.3,
  Balanced: 0.7,
  Imaginative: 1.0,
};

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_EMBED_MODEL = 'text-embedding-004';

export interface NodeGatewayOptions {
  apiKey: string;
  defaultModel?: string;
  embedModel?: string;
}

/** Resolve the API key from common env vars; throws a clear error when missing. */
export function resolveNodeApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key =
    env['GEMINI_API_KEY'] ?? env['STORYCRAFT_API_KEY'] ?? env['GOOGLE_GENERATIVE_AI_API_KEY'];
  if (!key) {
    throw new Error(
      'Missing API key. Set GEMINI_API_KEY (or STORYCRAFT_API_KEY) to enable AI-backed ProForge stages.',
    );
  }
  return key;
}

export class NodeInferenceGateway implements InferenceGateway {
  private readonly ai: GoogleGenAI;
  private readonly defaultModel: string;
  private readonly embedModel: string;

  constructor(opts: NodeGatewayOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.embedModel = opts.embedModel ?? DEFAULT_EMBED_MODEL;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model = request.options.model || this.defaultModel;
    const temperature = CREATIVITY_TEMPERATURE[request.creativity ?? 'Balanced'] ?? 0.7;
    const response = await this.ai.models.generateContent({
      model,
      contents: request.prompt,
      config: {
        temperature,
        ...(request.options.maxTokens !== undefined && {
          maxOutputTokens: request.options.maxTokens,
        }),
      },
    });
    return {
      text: response.text ?? '',
      model,
      provider: 'gemini',
      isFallback: false,
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    // QNBS-v3: best-effort — callers (memory bank) fall back to lexical ranking on empty vectors.
    try {
      const response = await this.ai.models.embedContent({
        model: this.embedModel,
        contents: request.text,
      });
      const values = response.embeddings?.[0]?.values ?? [];
      return { vector: values };
    } catch {
      return { vector: [] };
    }
  }

  async modelList(): Promise<ModelInfo[]> {
    return [
      {
        id: this.defaultModel,
        provider: 'gemini',
        displayName: this.defaultModel,
        isLocal: false,
      },
    ];
  }

  async healthCheck(): Promise<GatewayHealth> {
    const start = Date.now();
    try {
      await this.ai.models.generateContent({
        model: this.defaultModel,
        contents: 'ping',
        config: { maxOutputTokens: 1 },
      });
      return { status: 'ok', provider: 'gemini', latencyMs: Date.now() - start };
    } catch {
      return { status: 'unavailable', provider: 'gemini' };
    }
  }
}
