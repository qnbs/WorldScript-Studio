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

export { assertCloudAiAllowed } from './aiPolicy';
export { CREATIVITY_TO_TEMPERATURE } from './creativityTemperature';
export { createStoryCraftFetch } from './fetchAdapter';
export { normalizeOllamaModelId, normalizeOpenAiCompatibleBaseUrl } from './modelNormalization';
export {
  isOrchestrationReadyProvider,
  ORCHESTRATION_READY_PROVIDERS,
} from './orchestrationProviders';
export {
  createLanguageModelForStoryCraft,
  providerToKind,
  type StoryCraftLanguageModelConfig,
} from './providerFactory';
export { STORYCRAFT_COMPLETION_URL, storyCraftCompletionFetch } from './storyCraftCompletionFetch';
