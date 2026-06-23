import { streamText } from 'ai';
import { z } from 'zod';
import type { AIProvider, AiCreativity, AiModel } from '../../types';
import { createLogger } from '../logger';
import { storageService } from '../storageService';
import { assertCloudAiAllowed } from './aiPolicy';
import { aiUsageTracker } from './aiUsageTracker';
import { CREATIVITY_TO_TEMPERATURE } from './creativityTemperature';
import {
  buildOpenRouterStyleHeaders,
  normalizeOllamaModelId,
  normalizeOpenAiCompatibleBaseUrl,
} from './modelNormalization';
import {
  createLanguageModelForWorldScript,
  providerToKind,
  type WorldScriptLanguageModelConfig,
} from './providerFactory';

const aiProviderSchema = z.enum([
  'gemini',
  'openai',
  'anthropic',
  'grok',
  'ollama',
  'webllm',
  'onnx',
  'transformers',
]);

const completionBodySchema = z.object({
  prompt: z.string().min(1),
  provider: aiProviderSchema,
  /** Gespeicherter `AiModel`-String (inkl. `ollama/...`). */
  model: z.string(),
  creativity: z.enum(['Focused', 'Balanced', 'Imaginative']),
  maxOutputTokens: z.number().int().positive().optional(),
  ollamaBaseUrl: z.string().optional(),
  openAiCompatibleBaseUrl: z.string().optional(),
  openAiSiteUrl: z.string().optional(),
  openAiSiteTitle: z.string().optional(),
  // QNBS-v3: C-3 LoRA wiring — when enableLoraAdapters is on and an adapter has ollamaModelTag,
  // useWorldScriptAI passes it here so the Ollama model identifier is overridden at inference time.
  loraModelPath: z.string().optional(),
  // QNBS-v3 (Phase 1): opaque per-request correlation id propagated from useWorldScriptAI so the
  // client request log and this fetch-side failure log share one id. Never user-derived.
  correlationId: z.string().optional(),
  // QNBS-v3 (CodeAnt): which app surface owns this request, for per-surface token-usage attribution.
  source: z.string().optional(),
});

const log = createLogger('ai.completion');

/** Best-effort correlation-id read from the raw body so it is available even if schema parse fails. */
function readCorrelationId(raw: unknown): string | undefined {
  if (raw && typeof raw === 'object') {
    const v = (raw as Record<string, unknown>)['correlationId'];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Virtuelle URL — nur für `useCompletion`; der echte Transport läuft über `worldScriptCompletionFetch`. */
export const WORLDSCRIPT_COMPLETION_URL = 'worldscript-internal://completion';

async function resolveModelConfig(
  provider: AIProvider,
  model: string,
  ollamaBaseUrl: string | undefined,
  openAiExtras: {
    openAiCompatibleBaseUrl?: string;
    openAiSiteUrl?: string;
    openAiSiteTitle?: string;
  },
): Promise<WorldScriptLanguageModelConfig | { error: string; status: number }> {
  const kind = providerToKind(provider);
  if (kind === 'unsupported') {
    return {
      error:
        'This AI provider is not supported by the orchestration layer yet. Use Gemini, OpenAI or Ollama.',
      status: 422,
    };
  }
  if (kind === 'gemini') {
    const apiKey = await storageService.getGeminiApiKey();
    if (!apiKey) {
      return { error: 'No Gemini API key configured.', status: 401 };
    }
    const modelId = model.startsWith('gemini-') ? model : 'gemini-3.5-flash';
    return { provider: 'gemini', apiKey, modelId };
  }
  if (kind === 'openai') {
    const apiKey = await storageService.getApiKey('openai');
    if (!apiKey) {
      return { error: 'No OpenAI API key configured.', status: 401 };
    }
    const extraHeaders = buildOpenRouterStyleHeaders(
      openAiExtras.openAiSiteUrl,
      openAiExtras.openAiSiteTitle,
    );
    const customRoot = openAiExtras.openAiCompatibleBaseUrl?.trim();
    if (customRoot) {
      return {
        provider: 'openaiCompatible',
        baseURL: normalizeOpenAiCompatibleBaseUrl(customRoot),
        apiKey,
        modelId: model,
        ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
      };
    }
    return {
      provider: 'openai',
      apiKey,
      modelId: model.startsWith('gpt-') ? model : 'gpt-4o-mini',
      ...(extraHeaders !== undefined ? { headers: extraHeaders } : {}),
    };
  }
  const baseURL = normalizeOpenAiCompatibleBaseUrl(ollamaBaseUrl ?? 'http://localhost:11434');
  const modelId = normalizeOllamaModelId(model as AiModel);
  return {
    provider: 'openaiCompatible',
    baseURL,
    apiKey: 'ollama',
    modelId,
  };
}

/**
 * Custom `fetch` für `useCompletion` (`streamProtocol: 'text'`): führt `streamText` im Client aus
 * und liefert eine Text-Stream-Response — ohne separates Backend.
 */
// QNBS-v3: useCompletion verlangt fetch(URL) — Stream läuft clientseitig; URL-Parameter bleibt ungenutzt.
export async function worldScriptCompletionFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let correlationId: string | undefined;
  try {
    if (!init?.body || typeof init.body !== 'string') {
      throw new Error('Invalid WorldScript AI request body.');
    }
    const raw: unknown = JSON.parse(init.body);
    correlationId = readCorrelationId(raw);
    const parsed = completionBodySchema.parse(raw);
    const signal = init.signal ?? undefined;

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    await assertCloudAiAllowed(parsed.provider);

    const openAiExtras: {
      openAiCompatibleBaseUrl?: string;
      openAiSiteUrl?: string;
      openAiSiteTitle?: string;
    } = {
      ...(parsed.openAiCompatibleBaseUrl !== undefined && parsed.openAiCompatibleBaseUrl !== ''
        ? { openAiCompatibleBaseUrl: parsed.openAiCompatibleBaseUrl }
        : {}),
      ...(parsed.openAiSiteUrl !== undefined && parsed.openAiSiteUrl !== ''
        ? { openAiSiteUrl: parsed.openAiSiteUrl }
        : {}),
      ...(parsed.openAiSiteTitle !== undefined && parsed.openAiSiteTitle !== ''
        ? { openAiSiteTitle: parsed.openAiSiteTitle }
        : {}),
    };
    // QNBS-v3: C-3 LoRA wiring — Ollama model-tag override; mirrors aiProviderService.streamProvider() logic.
    const effectiveModel =
      parsed.provider === 'ollama' && parsed.loraModelPath ? parsed.loraModelPath : parsed.model;
    const resolved = await resolveModelConfig(
      parsed.provider,
      effectiveModel,
      parsed.ollamaBaseUrl,
      openAiExtras,
    );
    if ('error' in resolved) {
      return new Response(JSON.stringify({ error: resolved.error }), {
        status: resolved.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const model = createLanguageModelForWorldScript(resolved);
    const temperature = CREATIVITY_TO_TEMPERATURE[parsed.creativity as AiCreativity];
    const maxOutputTokens = parsed.maxOutputTokens ?? 2048;

    const result = streamText({
      model,
      prompt: parsed.prompt,
      ...(signal !== undefined ? { abortSignal: signal } : {}),
      temperature,
      maxOutputTokens,
      // QNBS-v3 (CodeAnt): report token usage scoped to the calling surface (this fetch is shared by
      // the Writer AND Global Copilot via useWorldScriptAI), so one never overwrites the other's
      // "last request" badge. No payload/token logging.
      onFinish: (event) => {
        if (event.usage) aiUsageTracker.record(event.usage, parsed.source ?? 'unknown');
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (err instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: 'Invalid completion request payload.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // QNBS-v3: never expose err.message in response body — may contain internal paths or tokens (CodeQL js/stack-trace-exposure)
    log.withContext({ correlationId }).error('worldScriptCompletionFetch failed', err);
    return new Response(JSON.stringify({ error: 'WorldScript AI request failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
