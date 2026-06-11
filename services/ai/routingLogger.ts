/**
 * routingLogger.ts
 * ----------------
 * Structured observability for AI routing decisions.
 * QNBS-v3: Every provider-selection event is logged with mode, reason, and latency so
 * routing behaviour is auditable without exposing sensitive payload data (G8).
 */
import type { AiMode } from '../../types';
import { createLogger, sanitizeLogContext } from '../logger';

const logger = createLogger('ai-routing');

export type RoutingReason =
  | 'mode-override' // shouldRouteLocally() forced a local provider
  | 'offline-fallback' // network offline — fell back to local
  | 'policy-gate' // assertCloudAiAllowed blocked cloud
  | 'openrouter-preferred' // OpenRouter preferred as cloud provider (enabled in settings)
  | 'openrouter-free' // Specifically a :free model on OpenRouter
  | 'openrouter-paid' // Non-free OpenRouter model
  | 'openrouter-rate-limit' // OpenRouter 429 — retrying or falling back
  | 'openrouter-fallback' // OpenRouter circuit open or persistent 429 — fell back to next provider
  | 'passthrough'; // no override; using configured provider

export interface RoutingDecision {
  mode: AiMode;
  originalProvider: string;
  chosenProvider: string;
  reason: RoutingReason;
  latencyMs?: number;
}

export function logRoutingDecision(opts: RoutingDecision): void {
  // sanitizeLogContext strips any accidental key/token fields before writing to IDB/console.
  logger.info('routing-decision', sanitizeLogContext(opts as unknown as Record<string, unknown>));
}
