/**
 * Universal AI Orchestration Layer — Einstiegspunkt (`services/ai/`).
 *
 * ## Writer-Streaming vs. Manuskript (Redux)
 * - Live-KI-Text landet im **`writer`-Slice** (`updateCurrentHistoryItem`, `appendResultStream`), nicht direkt in `project.manuscript`.
 * - Persistierung ins Manuskript erfolgt erst über **Accept** → `projectActions.updateManuscriptSection`.
 *
 * ## Thunk-Mapping (Legacy → Vercel AI SDK)
 * | Bereich | Legacy-Thunk | Neu |
 * |---------|----------------|-----|
 * | Writer | `streamGenerationThunk` | `useStoryCraftAI` + `useCompletion` + `streamText` |
 * | Synopsis / Text | `generateSynopsisThunk`, Feld-Regenerate | `generateText` (folgende Phasen) |
 * | JSON / Schema | `generate*Thunk` mit `generateJson` | `generateObject` (folgende Phasen) |
 * | Hilfe | `streamAiHelpResponse` | `streamText` / Hook (optional) |
 *
 * ## Hybrid-KI (Presets + BYOK)
 * Lokale OpenAI-kompatible Server (Ollama/LM Studio/vLLM) über **`settings.advancedAi.ollamaBaseUrl`** + Presets; Cloud-Router (OpenRouter/Groq) über **`openai`** + **`openAiCompatibleBaseUrl`** und denselben Key-Slot; Fallback-Kette für **Legacy-Thunks** in `aiProviderService.streamText` / `generateText`.
 *
 * QNBS-v3: Strangler-Pattern — neue Schicht parallel zu `aiProviderService.ts`, Redux bleibt Source of Truth.
 */

export {
  CREATIVITY_TO_TEMPERATURE,
  isLocalInferenceProvider,
  isOrchestrationReadyProvider,
  LOCAL_BACKEND_PRESET_DEFAULT_URL,
  LOCAL_INFERENCE_PROVIDERS,
  type LocalInferenceProvider,
  ORCHESTRATION_READY_PROVIDERS,
} from './aiConstants';
export { aiInferenceCacheService } from './aiInferenceCacheService';
export {
  getActiveAiMode,
  getLocalFallbackModel,
  getLocalModelsReady,
  getOpenRouterFallbackProvider,
  getOpenRouterModel,
  isCloudOnlyMode,
  isEcoMode,
  notifyLocalModelsReady,
  setActiveAiMode,
  setOpenRouterConfig,
  shouldRouteLocally,
  shouldUseOpenRouter,
} from './aiModeService';
export { assertCloudAiAllowed } from './aiPolicy';
export {
  type AiTaskType,
  type DeviceClass,
  type DeviceHealthReport,
  getDeviceClass,
  getHealthReport,
  getModelRecommendation,
  hasInsufficientStorage,
  isMemoryPressured,
} from './deviceHealthService';
export { ECO_MODE_MODEL_ID, ecoModeService } from './ecoModeService';
export { createWorldScriptFetch } from './fetchAdapter';
export {
  type GpuConsumer,
  type GpuPriority,
  gpuResourceManager,
} from './gpuResourceManager';
export {
  createInferenceGateway,
  DefaultInferenceGateway,
  type EmbedRequest,
  type EmbedResult,
  type GatewayHealth,
  type GenerateRequest,
  type GenerateResult,
  type InferenceGateway,
  inferenceGateway,
  type ModelInfo,
} from './inferenceGateway';
export {
  inferenceProgressEmitter,
  type WebLlmLoadingState,
  type WebLlmLoadProgress,
} from './inferenceProgressEmitter';
export {
  cosineSimilarity,
  type EmbeddingVector,
  embedBatch,
  embedText,
} from './localEmbeddingService';
export {
  analyzeSentiment,
  classifyWritingTopic,
  type SentimentResult,
  summarizeText,
} from './localNlpService';
export { normalizeOllamaModelId, normalizeOpenAiCompatibleBaseUrl } from './modelNormalization';
export {
  clearOpenRouterModelCache,
  fetchOpenRouterModels,
  getOpenRouterModelCatalog,
  isOpenRouterFreeModel,
  type OpenRouterModel,
  validateOpenRouterKey,
} from './openrouterModels';
export {
  createLanguageModelForWorldScript,
  providerToKind,
  type StoryCraftLanguageModelConfig,
} from './providerFactory';
export {
  getApproxRpm,
  isCircuitOpen,
  OPENROUTER_FREE_MODELS,
  type OpenRouterFreeModel,
  resetOpenRouterCircuit,
} from './providers/openrouterProvider';
export { logRoutingDecision, type RoutingDecision, type RoutingReason } from './routingLogger';
export { STORYCRAFT_COMPLETION_URL, storyCraftCompletionFetch } from './storyCraftCompletionFetch';
