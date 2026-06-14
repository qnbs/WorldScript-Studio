import {
  detectWebGpuSupport,
  type LocalAiLayer,
  type LocalAiResponse,
  runLocalTextGeneration,
  sanitizeForPrompt,
  surrenderLeadership,
  WEBLLM_SUPPORTED_MODELS,
  type WebLlmProgressReport,
  WorkerBus,
} from '@domain/ai-core';
import { adaptiveAiEngine } from './ai/adaptiveAiEngine';
import { notifyLocalModelsReady } from './ai/aiModeService';
import { gpuResourceManager } from './ai/gpuResourceManager';
import { inferenceProgressEmitter } from './ai/inferenceProgressEmitter';
import type { ComputeBackend } from './ai/localAiDeviceProfiler';
// QNBS-v3: C2 — lazy-import telemetry to avoid blocking cold start
import { logger } from './logger';
import { ensureWebLlmPool } from './workerBusManager';

// QNBS-v3: Legacy ai-core WorkerBus retained ONLY for telemetry continuity (getLocalWorkerBusTelemetry).
//          Heavy WebLLM inference now runs in the WorkerBus v2 `webllm` pool, not inline here.
const localWorkerBus = new WorkerBus();

// QNBS-v3: Count of in-flight generateLocalText calls (ANY layer — WebLLM worker, ONNX-WASM,
//          Transformers.js, heuristic). ONNX/Transformers run without the GPU mutex or a WebLLM
//          loading state, so this counter is what makes isLocalAiBusy() catch CPU/WASM inference too.
let inFlightLocalInference = 0;

// QNBS-v3: P1-1 — WebLLM model load + generation can be slow on first run (weights download).
//          A generous task timeout avoids premature cancellation; the main-thread fallback covers
//          genuine worker failures fast (spawn error / NO_WEBGPU), so this ceiling is rarely hit.
const WEBLLM_TASK_TIMEOUT_MS = 180_000;

// QNBS-v3: CodeAnt — map the executed LocalAiResponse.layer to the adaptive engine's ComputeBackend
//          so recorded latency reflects what ACTUALLY ran (a fallback must not be logged as the plan).
const LAYER_TO_COMPUTE_BACKEND: Record<string, ComputeBackend> = {
  webllm: 'webllm-webgpu',
  onnx: 'onnx-wasm',
  transformers: 'transformers-wasm',
  heuristic: 'heuristic',
};

interface WebLlmWorkerResult {
  text: string;
  layer: 'webllm';
  modelId: string;
}

/**
 * QNBS-v3: P1-1 — Run WebLLM inference in the dedicated WorkerBus v2 worker (off the main thread).
 * Returns a LocalAiResponse on success, or null to signal the caller to use its main-thread fallback
 * (no WebGPU in the worker, worker spawn failure, circuit open, or an empty completion).
 */
async function tryWebLlmWorker(
  prompt: string,
  modelId: string,
  loraAdapterId: string | undefined,
  onProgress: ((report: WebLlmProgressReport) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<LocalAiResponse | null> {
  try {
    const bus = await ensureWebLlmPool();
    if (!bus) return null;

    // QNBS-v3: Sanitize before crossing the worker boundary — mirrors runLocalTextGeneration's
    //          PII redaction + jailbreak filtering (the worker calls the engine directly).
    const sanitized = sanitizeForPrompt(prompt);
    if (!sanitized.trim()) return null;

    // QNBS-v3: exactOptionalPropertyTypes — only include loraAdapterId when defined.
    const payload: { prompt: string; modelId: string; loraAdapterId?: string } = {
      prompt: sanitized,
      modelId,
    };
    if (loraAdapterId !== undefined) payload.loraAdapterId = loraAdapterId;

    const handle = bus.enqueue<
      { prompt: string; modelId: string; loraAdapterId?: string },
      WebLlmWorkerResult
    >('inference.webllm', payload, {
      priority: 'normal',
      capabilities: ['inference.webllm'],
      timeoutMs: WEBLLM_TASK_TIMEOUT_MS,
      // QNBS-v3: Bridge worker progress → existing UI subscribers (inferenceProgressEmitter) AND
      //          the caller's onProgress, so the loading UX is identical to the main-thread path.
      onProgress: (p) => {
        if (p.stage === 'done') {
          inferenceProgressEmitter.reportWebLlmReady();
        } else {
          inferenceProgressEmitter.reportWebLlmProgress(p.progress, p.message ?? '');
          onProgress?.({ progress: p.progress, text: p.message ?? '' });
        }
      },
    });

    // QNBS-v3: Propagate caller aborts to the worker task.
    if (signal) {
      if (signal.aborted) handle.cancel('aborted');
      else signal.addEventListener('abort', () => handle.cancel('aborted'), { once: true });
    }

    const res = await handle.result;
    const text = res?.text?.trim();
    if (!text) return null;
    return { layer: 'webllm', text };
  } catch (err) {
    // QNBS-v3: CodeAnt — a caller-initiated abort/cancel must short-circuit, NOT trigger a second
    //          main-thread generation or emit a WebLLM error. Rethrow so generateLocalText unwinds.
    if (signal?.aborted || (err instanceof Error && /abort|cancel/i.test(err.message))) {
      throw err instanceof Error ? err : new Error('Aborted');
    }
    // QNBS-v3: genuine worker failure → fall back to the main-thread multi-layer orchestrator.
    inferenceProgressEmitter.reportWebLlmError(
      err instanceof Error ? err.message : 'WebLLM worker error',
    );
    logger.info('WebLLM worker unavailable, using main-thread fallback', { err: String(err) });
    return null;
  }
}

export async function generateLocalText(
  prompt: string,
  modelId?: string,
  onProgress?: (report: WebLlmProgressReport) => void,
  loraAdapterId?: string,
  signal?: AbortSignal,
  // QNBS-v3: bypassAdaptiveModel forces the caller's exact modelId (skips adaptive override) — used
  //          by preloadLocalModel so a "Download model X" action always warms X, never a substitute.
  options?: { bypassAdaptiveModel?: boolean },
): Promise<LocalAiResponse> {
  // QNBS-v3: Acquire GPU mutex before WebLLM/ONNX-WebGPU init to prevent VRAM races across
  //          concurrent callers (e.g. ProForge agents running multiple pipeline stages).
  //          Tab-leader election stays inside runLocalTextGeneration / the worker engine cache.
  const needsGpu = detectWebGpuSupport();
  if (needsGpu) await gpuResourceManager.acquireGpu('webllm', 'high');

  const startedAt = performance.now();
  inFlightLocalInference += 1;
  try {
    // QNBS-v3: When adaptive AI engine is enabled, use its task config for optimal backend/model.
    const adaptiveEnabled =
      typeof window !== 'undefined' && window.__storycraft_adaptive_ai__ === true;

    // QNBS-v3: capture the typed adaptive config so recordTaskLatency keeps its ComputeBackend type.
    //          Skipped entirely when the caller forces an exact model (explicit preload/download).
    const adaptiveConfig =
      adaptiveEnabled && !options?.bypassAdaptiveModel
        ? await adaptiveAiEngine.getTaskConfig('text-gen-short')
        : null;

    let usedBackend: string = adaptiveConfig?.backend ?? 'heuristic';
    let usedModel = adaptiveConfig?.modelId ?? modelId ?? 'unknown';
    const fallbackModelId = adaptiveConfig?.modelId ?? modelId;
    const workerModelId = fallbackModelId ?? WEBLLM_SUPPORTED_MODELS[0].id;

    let result: LocalAiResponse | null = null;

    // QNBS-v3: P1-1 — Worker-first WebLLM. Only attempt when WebGPU is present AND the runtime has
    //          Workers (real browsers); otherwise skip straight to the main-thread orchestrator.
    if (needsGpu && typeof Worker !== 'undefined') {
      result = await tryWebLlmWorker(prompt, workerModelId, loraAdapterId, onProgress, signal);
      if (result) {
        usedBackend = 'webllm';
        usedModel = workerModelId;
      }
    }

    // QNBS-v3: Fallback — full main-thread chain (WebLLM no-ops without GPU, then ONNX → Transformers
    //          → heuristic). Also the path when the worker is unavailable or returns nothing.
    if (!result) {
      result = await runLocalTextGeneration(prompt, fallbackModelId, onProgress, signal);
      usedBackend = result.layer;
      usedModel = fallbackModelId ?? usedModel;
    }

    const elapsedMs = performance.now() - startedAt;

    // QNBS-v3: Phase 2 — notify aiModeService that real local models are available so hybrid
    // mode knows fallback is possible when offline. Only fires for actual inference layers
    // (webllm/onnx/transformers), not the heuristic stub (G4).
    if (result.layer !== 'heuristic') {
      notifyLocalModelsReady(true);
    }

    // QNBS-v3: CodeAnt — record latency against the ACTUAL backend/model that produced the response
    //          (not the adaptively-planned one), so a fallback doesn't poison adaptive history.
    if (adaptiveConfig) {
      adaptiveAiEngine.recordTaskLatency(
        'text-gen-short',
        LAYER_TO_COMPUTE_BACKEND[usedBackend] ?? 'heuristic',
        usedModel,
        elapsedMs,
      );
    }
    localWorkerBus.recordResult(elapsedMs, true);

    // QNBS-v3: C2 — record telemetry asynchronously (non-blocking, fire-and-forget)
    import('./ai/telemetryService')
      .then(({ recordInferenceTelemetry }) => {
        void recordInferenceTelemetry({
          taskType: 'text-gen-short',
          backend: usedBackend,
          modelId: usedModel,
          latencyMs: Math.round(elapsedMs),
          success: true,
          timestamp: Date.now(),
        });
      })
      .catch(() => {
        /* telemetry is best-effort */
      });
    return result;
  } catch (err) {
    // QNBS-v3: Log the actual error so telemetry and bug reports are useful.
    logger.warn('Local text generation failed:', err);
    localWorkerBus.recordResult(performance.now() - startedAt, false);

    // QNBS-v3: C2 — record failure telemetry
    import('./ai/telemetryService')
      .then(({ recordInferenceTelemetry }) => {
        void recordInferenceTelemetry({
          taskType: 'text-gen-short',
          backend: 'heuristic',
          modelId: modelId ?? 'unknown',
          latencyMs: Math.round(performance.now() - startedAt),
          success: false,
          timestamp: Date.now(),
        });
      })
      .catch(() => {
        /* telemetry is best-effort */
      });

    return { layer: 'heuristic', text: 'Heuristic fallback response' };
  } finally {
    inFlightLocalInference = Math.max(0, inFlightLocalInference - 1);
    // QNBS-v3: Always release — gpuResourceManager has a 30s auto-release safety net too.
    if (needsGpu) gpuResourceManager.releaseGpu('webllm');
    // QNBS-v3: Surrender tab leader heartbeat so next inference cycle elects fairly.
    surrenderLeadership();
  }
}

export function getLocalWorkerBusTelemetry() {
  return localWorkerBus.getTelemetry();
}

// QNBS-v3: Last measured local-inference throughput (tokens/sec), best-effort, for the Local AI
//          settings perf indicator. Token count is approximated as chars/4 (typical English ratio).
export interface LocalThroughputSample {
  tokensPerSecond: number;
  modelId: string;
  at: number;
}

let lastLocalThroughput: LocalThroughputSample | null = null;

export function getLastLocalThroughput(): LocalThroughputSample | null {
  return lastLocalThroughput;
}

export interface PreloadResult {
  /** The backend that actually served the warm-up (webllm / onnx / transformers / heuristic). */
  layer: LocalAiLayer;
  modelId: string;
  /**
   * True only when the REQUESTED WebLLM model genuinely warmed — i.e. the webllm layer ran and it
   * was not the multi-tab lock message. An ONNX/Transformers fallback (e.g. no WebGPU) is NOT a
   * download of the requested model, so the UI must not mark it "ready".
   */
  downloaded: boolean;
}

// QNBS-v3: runLocalTextGeneration returns layer:'webllm' with this sentinel text when another tab
//          holds the GPU lock — that is NOT a successful warm of the requested model.
function isWebLlmLockMessage(text: string): boolean {
  return text.startsWith('WebLLM: Another');
}

// QNBS-v3: Session-level set of models verified-warmed this session. Module scope (not React state)
//          so the "Ready" status survives the Settings section unmounting/remounting on navigation.
const readyLocalModelIds = new Set<string>();

export function getReadyLocalModelIds(): readonly string[] {
  return Array.from(readyLocalModelIds);
}

/** Reset session readiness — call after the on-disk model caches are cleared. */
export function clearReadyLocalModels(): void {
  readyLocalModelIds.clear();
}

// QNBS-v3: Abort hook for the in-flight preload so the download modal's Cancel can truly stop it
//          (not just hide the UI). Only one preload runs at a time (GPU mutex), so a single ref is safe.
let activePreloadAbort: (() => void) | null = null;

export function abortActivePreload(): void {
  activePreloadAbort?.();
}

/**
 * QNBS-v3: True when ANY local-AI work is in flight app-wide — a held GPU mutex (WebLLM/ONNX-WebGPU
 * inference from Copilot/ProForge/Writer/preload) or an active WebLLM download. Used to block
 * "Clear Local Models" so it can't release engines / delete caches mid-run.
 */
export function isLocalAiBusy(): boolean {
  return (
    inFlightLocalInference > 0 ||
    gpuResourceManager.getQueueState().current !== null ||
    inferenceProgressEmitter.getWebLlmLoadingSnapshot().state === 'loading'
  );
}

/**
 * QNBS-v3: Explicitly download/warm a local model so users can prepare offline use from Settings.
 * Routes through generateLocalText (worker-first, adaptive override bypassed) so it reuses the GPU
 * mutex, inferenceProgressEmitter, and the global LocalAiDownloadProgress modal. The download is
 * cancellable via abortActivePreload(). Records tok/s + marks ready ONLY for a verified WebLLM warm
 * of the REQUESTED model, so neither the perf indicator nor the Ready badge reflects a fallback.
 */
export async function preloadLocalModel(
  modelId: string,
  onProgress?: (report: WebLlmProgressReport) => void,
  signal?: AbortSignal,
): Promise<PreloadResult> {
  // QNBS-v3: own the AbortController so both the modal Cancel (abortActivePreload) and a caller
  //          signal (e.g. unmount) can stop the underlying generation/worker task.
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  // QNBS-v3: capture our own hook so an older preload finishing later can't null out a newer
  //          preload's cancel hook — only clear it in finally if it's still ours (identity guard).
  const abortHook = () => controller.abort();
  activePreloadAbort = abortHook;

  const startedAt = performance.now();
  try {
    // QNBS-v3: A minimal prompt forces the weight download + a short warm-up generation.
    const res = await generateLocalText('Hi', modelId, onProgress, undefined, controller.signal, {
      bypassAdaptiveModel: true,
    });
    const elapsedSec = (performance.now() - startedAt) / 1000;

    const downloaded = res.layer === 'webllm' && !isWebLlmLockMessage(res.text);
    if (downloaded) {
      readyLocalModelIds.add(modelId);
      if (elapsedSec > 0) {
        const approxTokens = Math.max(1, Math.round(res.text.length / 4));
        lastLocalThroughput = {
          tokensPerSecond: Math.round(approxTokens / elapsedSec),
          modelId,
          at: Date.now(),
        };
      }
    }
    return { layer: res.layer, modelId, downloaded };
  } finally {
    if (activePreloadAbort === abortHook) activePreloadAbort = null;
  }
}
