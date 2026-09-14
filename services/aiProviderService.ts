/**
 * Compatibility façade for the legacy AI provider entrypoint.
 *
 * QNBS-v3: New provider work belongs in `services/ai/`; this module keeps existing callers stable
 * while the Strangler Pattern is consolidated behind cohesive contracts, lifecycle, orchestration,
 * provider, and discovery modules.
 */

import type { AiCreativity } from '../types';
import type { AIRequestOptions, AIStreamCallbacks } from './ai/contracts/providerRequest';
import { testAIConnection } from './ai/discovery/connectionTests';
import {
  listLocalBackendModels,
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  testOpenAiCompatibleLocalConnection,
} from './ai/discovery/localModelDiscovery';
import { generateImage } from './ai/orchestration/generateImage';
import { generateJson } from './ai/orchestration/generateJson';
import { generateText } from './ai/orchestration/generateText';
import {
  streamAiHelpResponse as streamAiHelpResponseOperation,
  streamText as streamTextOperation,
} from './ai/orchestration/streamText';

export type {
  AIRequestOptions,
  AIStreamCallbacks,
} from './ai/contracts/providerRequest';
export {
  type TestConnectionErrorKind,
  type TestConnectionResult,
  testAIConnection,
} from './ai/discovery/connectionTests';
export {
  type LocalEndpointScanResult,
  type LocalEndpointScanState,
  type LocalServerDiagnostic,
  listLocalBackendModels,
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  testOpenAiCompatibleLocalConnection,
} from './ai/discovery/localModelDiscovery';
export { isAbortError } from './ai/lifecycle/cancellation';
export { clearPendingRequestsForTest as _clearPendingRequestsForTest } from './ai/lifecycle/requestDedup';
export {
  clearLastAiFallbackReason,
  getLastAiFallbackReason,
} from './ai/orchestration/fallbackState';
export { generateImage } from './ai/orchestration/generateImage';
export { generateJson } from './ai/orchestration/generateJson';
export { generateText } from './ai/orchestration/generateText';

export { GROK_API_ENDPOINT } from './ai/providers/openaiProvider';

export function streamText(
  prompt: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  return streamTextOperation({ prompt, creativity, opts, callbacks, signal });
}

export function streamAiHelpResponse(
  question: string,
  creativity: AiCreativity,
  opts: AIRequestOptions,
  callbacks: AIStreamCallbacks,
  extras?: { docContext?: string },
): Promise<void> {
  return streamAiHelpResponseOperation({ question, creativity, opts, callbacks, extras });
}

// QNBS-v3: Namespace object for ProForge agents — preserves the legacy singleton surface while
// each operation is implemented by its cohesive owner under services/ai/.
export const aiProviderService = {
  generateText,
  generateJson,
  generateImage,
  streamText,
  streamAiHelpResponse,
  listOllamaModels,
  listLocalBackendModels,
  scanLocalOpenAiCompatibleEndpoints,
  testOpenAiCompatibleLocalConnection,
  testAIConnection,
};
