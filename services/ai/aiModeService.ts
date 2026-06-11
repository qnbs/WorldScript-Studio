/**
 * aiModeService.ts
 * ----------------
 * Singleton routing service for the AI execution mode.
 *
 * Mirrors the CannaGuide-2025 localRoutingService pattern (ADR-0006).
 * Controls whether AI calls are routed to cloud providers, local on-device
 * models, or resolved automatically. Callers use shouldRouteLocally() to
 * decide the routing path without importing Redux.
 *
 * Sync'd from Redux via listenerMiddleware on every setAiMode / setSettings
 * dispatch — never import directly from featureFlags or Redux here.
 */
import type { AiMode } from '../../types';

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

let _mode: AiMode = 'hybrid';
let _localModelsReady = false;

/** Called from listenerMiddleware on setAiMode / setSettings. */
export const setActiveAiMode = (mode: AiMode): void => {
  _mode = mode;
};

/** Returns the current active AI execution mode. */
export const getActiveAiMode = (): AiMode => _mode;

/** Notify the service that local models have finished loading. */
export const notifyLocalModelsReady = (ready: boolean): void => {
  _localModelsReady = ready;
};

/**
 * Whether local models are currently loaded and ready for inference.
 * Does not affect routing decisions (hybrid is cloud-first) but is exposed
 * for observability: UI indicators, health panels, and diagnostics can read it.
 */
export const getLocalModelsReady = (): boolean => _localModelsReady;

/**
 * Whether the current mode mandates local-only inference.
 *
 * - local / eco: always true
 * - cloud:       true only when offline (force fallback, no network)
 * - hybrid:      true only when offline (cloud-first; local as offline fallback only)
 *
 * QNBS-v3: Hybrid is cloud-first per ADR-0006 decision 2026-06-11 — local kicks in only on
 * offline, not merely because a local model is ready. _localModelsReady is retained as a
 * signal for faster offline recovery but does not promote to local while online.
 */
export const shouldRouteLocally = (): boolean => {
  if (_mode === 'local' || _mode === 'eco') return true;
  // cloud and hybrid: only route locally when offline
  return isOffline();
};

/** True when eco mode is active (smallest models, no cloud). */
export const isEcoMode = (): boolean => _mode === 'eco';

/** True when only cloud providers should be used. */
export const isCloudOnlyMode = (): boolean => _mode === 'cloud' && !isOffline();

/**
 * Returns the local model ID to use when `shouldRouteLocally()` overrides provider selection.
 * eco → SmolLM2-135M (tiny, <300 MB); local/hybrid → Llama 3.2 1B (balanced quality).
 */
export const getLocalFallbackModel = (): string => {
  // QNBS-v3: ECO_MODE_MODEL_ID avoids a circular import of ecoModeService — inline the constant.
  if (_mode === 'eco') return 'HuggingFaceTB/SmolLM2-135M-Instruct';
  return 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
};

// ─── OpenRouter routing helpers ─────────────────────────────────────────────

let _openRouterEnabled = false;
let _openRouterModel = 'deepseek/deepseek-r1:free';

/** Called from listenerMiddleware when openRouter settings change. */
export const setOpenRouterConfig = (enabled: boolean, preferredModel: string): void => {
  _openRouterEnabled = enabled;
  _openRouterModel = preferredModel || 'deepseek/deepseek-r1:free';
};

/**
 * Whether OpenRouter should be used as the preferred cloud provider.
 * True when enabled + mode is cloud, hybrid, or eco (free-tier supplements local eco).
 * Always false in local mode (local-only — no cloud allowed).
 */
export const shouldUseOpenRouter = (): boolean => {
  if (!_openRouterEnabled) return false;
  if (_mode === 'local') return false;
  return true;
};

/** Returns the configured OpenRouter model (default: DeepSeek R1 free). */
export const getOpenRouterModel = (): string => _openRouterModel;

/**
 * Returns the fallback provider chain when OpenRouter is rate-limited or circuit-open.
 * eco/local modes fall back to webllm; cloud/hybrid fall back to gemini.
 */
export const getOpenRouterFallbackProvider = (): string => {
  if (_mode === 'eco' || _mode === 'local') return 'webllm';
  return 'gemini'; // cloud/hybrid: fall through to the configured gemini key
};
