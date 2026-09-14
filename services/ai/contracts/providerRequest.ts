import type {
  AIProvider,
  AiCreativity,
  AiModel,
  GeminiSchema,
  LocalBackendPreset,
} from '../../../types';
import type { HeuristicContext } from '../heuristicFallback';

export interface AIRequestOptions {
  model: AiModel;
  provider: AIProvider;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Scopes service-level duplicate cancellation to the owning project incarnation when known. */
  deduplicationScope?: string;
  ollamaBaseUrl?: string;
  /** Selects the local-server protocol; LM Studio and vLLM expose OpenAI-compatible `/v1` APIs. */
  localBackendPreset?: LocalBackendPreset;
  // QNBS-v3 (ADR-0017): opt-in — attempt a direct browser→Ollama fetch instead of requiring
  // desktop. Only meaningful when provider is 'ollama' and isTauriRuntime() is false.
  browserOllamaEnabled?: boolean;
  fallbackProviders?: AIProvider[];
  /** Leer = api.openai.com; sonst OpenRouter/Groq/OpenAI-kompatible Root-URL. */
  openAiCompatibleBaseUrl?: string;
  openAiSiteUrl?: string;
  openAiSiteTitle?: string;
  hybridFallbackEnabled?: boolean;
  hybridFallbackChain?: AIProvider[];
  // QNBS-v3: C-3 LoRA wiring — when set and provider is 'ollama', this tag overrides opts.model.
  // Tag must be created via `ollama create <tag> -f Modelfile` with the adapter baked in.
  loraModelPath?: string;
  // QNBS-v3: heuristic-fallback wiring — task id + context for the registered per-feature generator
  // used when the AI path is terminally unavailable. Absent → no heuristic fallback (legacy behavior).
  heuristicTask?: string;
  heuristicContext?: HeuristicContext;
}

export interface AIStreamCallbacks {
  onChunk: (text: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export type { AIProvider, AiCreativity, AiModel, GeminiSchema, LocalBackendPreset };
