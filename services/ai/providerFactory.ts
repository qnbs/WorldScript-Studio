import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import type { AIProvider } from '../../types';
import { createWorldScriptFetch } from './fetchAdapter';

/** Konfiguration zur Erzeugung eines `LanguageModel` (erweiterbar um WebLLM o. Ä.). */
export type StoryCraftLanguageModelConfig =
  | {
      provider: 'gemini';
      /** Gemini-Modell-ID (z. B. `gemini-3.5-flash`). */
      modelId: string;
      apiKey: string;
    }
  | {
      provider: 'openai';
      modelId: string;
      apiKey: string;
      /** QNBS-v3: z. B. OpenRouter-Attribution — optional, nur bei kompatiblen Hosts. */
      headers?: Record<string, string>;
    }
  | {
      provider: 'openaiCompatible';
      /** OpenAI-kompatible Root-URL inkl. `/v1` (Ollama, LM Studio). */
      baseURL: string;
      /** Ollama ignoriert oft den Key — Platzhalter zulässig. */
      apiKey: string;
      /** Roh-Modellname ohne `ollama/`-Prefix. */
      modelId: string;
      /** QNBS-v3: OpenRouter `HTTP-Referer` / `X-Title` bei Bedarf. */
      headers?: Record<string, string>;
    };

function resolveFetch(): typeof globalThis.fetch {
  return createWorldScriptFetch() as typeof globalThis.fetch;
}

/**
 * Erzeugt ein Vercel-AI-SDK-`LanguageModel` — Provider-frei für `streamText` / `generateText`.
 * QNBS-v3: zentrale Fabrik für Gemini + OpenAI-kompatibel (lokal); WebLLM später als eigene Union-Verzweigung.
 */
export function createLanguageModelForWorldScript(
  config: StoryCraftLanguageModelConfig,
): LanguageModel {
  const fetchImpl = resolveFetch();

  switch (config.provider) {
    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        fetch: fetchImpl,
      });
      return google.languageModel(config.modelId);
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        fetch: fetchImpl,
        ...(config.headers !== undefined ? { headers: config.headers } : {}),
      });
      return openai.chat(config.modelId);
    }
    case 'openaiCompatible': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        fetch: fetchImpl,
        ...(config.headers !== undefined ? { headers: config.headers } : {}),
      });
      return openai.chat(config.modelId);
    }
  }
}

/** Mappt Redux-`AIProvider` auf Fabrik-Union (ohne Keys — Auflösung in `storyCraftCompletionFetch`). */
export function providerToKind(
  provider: AIProvider,
): 'gemini' | 'openai' | 'openaiCompatible' | 'unsupported' {
  // QNBS-v3: webllm/onnx/transformers route through localAiFacade, not this factory.
  // anthropic/grok are reserved in the type union but not yet implemented here.
  switch (provider) {
    case 'gemini':
      return 'gemini';
    case 'openai':
      return 'openai';
    case 'ollama':
      return 'openaiCompatible';
    default:
      return 'unsupported';
  }
}
