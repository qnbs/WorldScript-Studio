/**
 * adaptiveAiEngine — Runtime backend/model selection engine for local AI inference.
 * QNBS-v3: Maps task type + device capability → optimal backend + model.
 *          Supports model pre-warming, release, and latency estimation.
 */

// QNBS-v3: ONNX_SUPPORTED_MODELS and WEBLLM_SUPPORTED_MODELS are available from @domain/ai-core
//          but not directly used here — selectModelForBackend uses hardcoded IDs for tighter control.
import {
  type ComputeBackend,
  type DeviceCapabilityProfile,
  getDeviceProfile,
  invalidateDeviceProfile,
} from './localAiDeviceProfiler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiTaskType =
  | 'text-gen-short' // ≤256 tokens, fast response
  | 'text-gen-long' // >256 tokens, quality priority
  | 'embedding' // Semantic embedding for RAG
  | 'vision' // Image caption / OCR
  | 'rag-rank' // RAG result ranking
  | 'voice-preprocess' // Audio preprocessing + VAD
  | 'grammar-check' // Sentence-level grammar/style
  | 'summarize'; // Text summarization

export interface TaskConfig {
  backend: ComputeBackend;
  modelId: string;
  estimatedLatencyMs: number;
  powerPreference?: 'low-power' | 'high-performance';
}

export interface WarmedModelEntry {
  task: AiTaskType;
  modelId: string;
  backend: ComputeBackend;
  warmedAt: number;
  lastUsedAt: number;
}

// ---------------------------------------------------------------------------
// Task → Backend Mapping
// ---------------------------------------------------------------------------

const TASK_BACKEND_PRIORITY: Record<AiTaskType, ComputeBackend[]> = {
  'text-gen-short': [
    'webllm-webgpu',
    'onnx-directml',
    'onnx-webnn',
    'onnx-webgpu',
    'transformers-webgpu',
    'onnx-wasm',
    'transformers-wasm',
    'heuristic',
  ],
  'text-gen-long': [
    'webllm-webgpu',
    'onnx-directml',
    'onnx-webnn',
    'onnx-webgpu',
    'transformers-webgpu',
    'onnx-wasm',
    'transformers-wasm',
    'heuristic',
  ],
  embedding: ['transformers-webgpu', 'transformers-wasm', 'onnx-webgpu', 'onnx-wasm', 'heuristic'],
  vision: ['webllm-webgpu', 'transformers-webgpu', 'transformers-wasm', 'heuristic'],
  'rag-rank': ['onnx-webgpu', 'transformers-webgpu', 'onnx-wasm', 'transformers-wasm', 'heuristic'],
  'voice-preprocess': [
    'onnx-webgpu',
    'transformers-webgpu',
    'onnx-wasm',
    'transformers-wasm',
    'heuristic',
  ],
  'grammar-check': [
    'transformers-webgpu',
    'onnx-webgpu',
    'transformers-wasm',
    'onnx-wasm',
    'heuristic',
  ],
  summarize: ['transformers-webgpu', 'onnx-webgpu', 'transformers-wasm', 'onnx-wasm', 'heuristic'],
};

// ---------------------------------------------------------------------------
// Model Selection
// ---------------------------------------------------------------------------

function selectModelForBackend(backend: ComputeBackend, profile: DeviceCapabilityProfile): string {
  const isWebllm = backend.startsWith('webllm');
  const isOnnx = backend.startsWith('onnx');
  const isTransformers = backend.startsWith('transformers');

  if (isWebllm) {
    const vram = profile.webgpu.vramTier ?? 'low';
    if (vram === 'high') return 'Phi-4-mini-instruct-q4f16_1-MLC';
    if (vram === 'medium') return 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
    return 'gemma-3-1b-it-q4f16_1-MLC';
  }

  if (isOnnx || isTransformers) {
    const mem = profile.memoryTier;
    if (mem === 'high') return 'Xenova/Qwen2.5-1.5B-Instruct';
    if (mem === 'medium') return 'Xenova/Qwen2.5-0.5B-Instruct';
    return 'HuggingFaceTB/SmolLM2-135M-Instruct';
  }

  return 'heuristic';
}

// ---------------------------------------------------------------------------
// Latency Estimation (benchmark history)
// ---------------------------------------------------------------------------

const latencyHistory = new Map<string, number[]>();
const MAX_HISTORY_ENTRIES = 10;

function recordLatency(key: string, latencyMs: number): void {
  const arr = latencyHistory.get(key) ?? [];
  arr.push(latencyMs);
  if (arr.length > MAX_HISTORY_ENTRIES) arr.shift();
  latencyHistory.set(key, arr);
}

function estimateLatency(key: string): number {
  const arr = latencyHistory.get(key);
  if (!arr || arr.length === 0) return 500; // Default guess
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** @internal For test isolation. */
export function _clearLatencyHistory(): void {
  latencyHistory.clear();
}

// ---------------------------------------------------------------------------
// Core Engine
// ---------------------------------------------------------------------------

class AdaptiveAiEngine {
  private warmedModels = new Map<string, WarmedModelEntry>();
  private readonly maxWarmedModels = 3;

  /** Get the optimal task configuration for the current device. */
  async getTaskConfig(task: AiTaskType): Promise<TaskConfig> {
    const profile = await getDeviceProfile();
    const priorityList = TASK_BACKEND_PRIORITY[task];

    // Find the first backend in priority list that the device supports
    let selectedBackend: ComputeBackend = 'heuristic';
    for (const candidate of priorityList) {
      if (this.isBackendAvailable(candidate, profile)) {
        selectedBackend = candidate;
        break;
      }
    }

    const modelId = selectModelForBackend(selectedBackend, profile);
    const latencyKey = `${task}:${selectedBackend}:${modelId}`;
    const estimatedLatencyMs = estimateLatency(latencyKey);

    return {
      backend: selectedBackend,
      modelId,
      estimatedLatencyMs,
      powerPreference:
        profile.battery.level !== null && profile.battery.level < 0.3
          ? 'low-power'
          : 'high-performance',
    };
  }

  /** Check if a specific backend is available on the current device. */
  isBackendAvailable(backend: ComputeBackend, profile: DeviceCapabilityProfile): boolean {
    switch (backend) {
      case 'webllm-webgpu':
        return profile.webgpu.available && profile.webgpu.vramTier !== undefined;
      case 'onnx-directml':
        return profile.directml.available;
      case 'onnx-webnn':
        return profile.webnn.available;
      case 'onnx-webgpu':
        return profile.webgpu.available;
      case 'transformers-webgpu':
        return profile.webgpu.available;
      case 'onnx-wasm':
      case 'transformers-wasm':
        return true; // WASM always works
      case 'heuristic':
        return true;
      default:
        return false;
    }
  }

  /** Pre-warm a model for a task (load into memory before user action). */
  async prewarmModel(task: AiTaskType): Promise<void> {
    const config = await this.getTaskConfig(task);
    const cacheKey = `${task}:${config.backend}:${config.modelId}`;

    // Evict oldest if at capacity
    if (this.warmedModels.size >= this.maxWarmedModels) {
      let oldestKey = '';
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.warmedModels) {
        if (entry.lastUsedAt < oldestTime) {
          oldestTime = entry.lastUsedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.warmedModels.delete(oldestKey);
      }
    }

    this.warmedModels.set(cacheKey, {
      task,
      modelId: config.modelId,
      backend: config.backend,
      warmedAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  }

  /** Release a pre-warmed model (free memory under pressure). */
  releaseModel(task: AiTaskType): void {
    // Find any entry matching this task prefix
    for (const [key] of this.warmedModels) {
      if (key.startsWith(`${task}:`)) {
        this.warmedModels.delete(key);
        return;
      }
    }
  }

  /** Check if a model is pre-warmed for a task. */
  isWarmed(task: AiTaskType): boolean {
    for (const key of this.warmedModels.keys()) {
      if (key.startsWith(`${task}:`)) return true;
    }
    return false;
  }

  /** Record actual latency for future estimates. */
  recordTaskLatency(
    task: AiTaskType,
    backend: ComputeBackend,
    modelId: string,
    latencyMs: number,
  ): void {
    const key = `${task}:${backend}:${modelId}`;
    recordLatency(key, latencyMs);
  }

  /** Get current warmed model list (for debugging / telemetry). */
  getWarmedModels(): WarmedModelEntry[] {
    return Array.from(this.warmedModels.values());
  }

  /** Refresh device profile (call on visibilitychange or battery event). */
  refreshProfile(): void {
    invalidateDeviceProfile();
  }
}

// Singleton instance
export const adaptiveAiEngine = new AdaptiveAiEngine();

// Re-export for testing
export { AdaptiveAiEngine };

// Convenience function for external use (wraps singleton)
export async function getTaskConfig(task: AiTaskType): Promise<TaskConfig> {
  return adaptiveAiEngine.getTaskConfig(task);
}
