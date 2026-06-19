/**
 * LoRA Training Service
 * QNBS-v3: Tauri sidecar bridge for Python/Unsloth training + progress streaming.
 *          Gracefully degrades on web build (returns isDesktopOnly: true).
 */

import { v4 as uuid } from 'uuid';
import type { HyperparamPreset } from '../../features/lora/types';
import { logger } from '../logger';
// QNBS-v3 (T0): use the canonical hardened detector instead of a local `__TAURI_INTERNALS__` check
// (the drift this consolidates). isTauriRuntime() now accepts `__TAURI_INTERNALS__` too.
import { isTauriRuntime as isTauri } from '../tauriRuntime';

export interface TrainingJobConfig {
  projectId: string;
  baseModelId: string;
  datasetPath: string;
  outputDir: string;
  preset: HyperparamPreset;
  customRank?: number;
  customAlpha?: number;
  customEpochs?: number;
  customMaxSeqLen?: number;
}

export interface TrainingProgressEvent {
  event: 'loading_model' | 'dataset_loaded' | 'progress' | 'completed' | 'error';
  model?: string;
  size?: number;
  epoch?: number;
  step?: number;
  loss?: number;
  progress_percent?: number;
  adapter_path?: string;
  gguf_path?: string;
  message?: string;
}

export interface TrainingResult {
  runId: string;
  adapterPath: string;
  ggufPath: string;
}

/** Invoke a Tauri command, typed. Throws on web build. */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Tauri not available');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Listen to a Tauri event stream. Returns an unlisten function. */
async function tauriListen(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen(event, (e) => handler(e.payload));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TrainingSessionHandle {
  runId: string;
  abort: () => Promise<void>;
}

export async function startTraining(
  config: TrainingJobConfig,
  onProgress: (event: TrainingProgressEvent) => void,
): Promise<TrainingResult> {
  if (!isTauri()) {
    throw new Error('LoRA training requires the WorldScript Studio desktop app.');
  }
  const runId = uuid();
  logger.info('loraTrainingService: starting training run', { runId, preset: config.preset.id });

  const unlisten = await tauriListen('lora-progress', (payload) => {
    onProgress(payload as TrainingProgressEvent);
  });

  try {
    await tauriInvoke('train_lora', {
      payload: {
        model_id: config.baseModelId,
        dataset_path: config.datasetPath,
        output_dir: config.outputDir,
        preset: config.preset.id,
        rank: config.customRank ?? null,
        alpha: config.customAlpha ?? null,
        epochs: config.customEpochs ?? null,
        max_seq_len: config.customMaxSeqLen ?? null,
      },
    });

    const adapterPath = `${config.outputDir}/adapter`;
    const ggufPath = `${config.outputDir}/adapter.gguf`;
    return { runId, adapterPath, ggufPath };
  } finally {
    unlisten();
  }
}

export async function abortTraining(): Promise<void> {
  if (!isTauri()) return;
  try {
    await tauriInvoke('abort_lora_training');
  } catch (err) {
    logger.warn('loraTrainingService: abort failed', { err });
  }
}

export async function mergeAdapter(
  baseModel: string,
  adapterPath: string,
  outputPath: string,
): Promise<void> {
  if (!isTauri()) throw new Error('Merge requires the desktop app.');
  await tauriInvoke('merge_lora', {
    base_model: baseModel,
    adapter_path: adapterPath,
    output_path: outputPath,
  });
}

export async function generateOllamaModelfile(
  baseModel: string,
  adapterPath: string,
  name: string,
): Promise<string> {
  if (isTauri()) {
    return tauriInvoke<string>('generate_ollama_modelfile', {
      base_model: baseModel,
      adapter_path: adapterPath,
      name,
    });
  }
  // Web fallback — generate template locally
  return `FROM ${baseModel}\nADAPTER ${adapterPath}\nSYSTEM "You are ${name}, a writing assistant trained on this author's style. Match their voice precisely."\n`;
}

/** Check if training environment is available (Python + Unsloth). Tauri-only. */
export async function checkTrainingEnvironment(): Promise<{
  pythonAvailable: boolean;
  unslothAvailable: boolean;
  cudaAvailable: boolean;
  vramGb: number;
  message?: string;
}> {
  if (!isTauri()) {
    return {
      pythonAvailable: false,
      unslothAvailable: false,
      cudaAvailable: false,
      vramGb: 0,
      message: 'Training is only available in the desktop app.',
    };
  }
  try {
    const result = await tauriInvoke<{
      python_available: boolean;
      unsloth_available: boolean;
      cuda_available: boolean;
      vram_gb: number;
    }>('check_lora_environment');
    return {
      pythonAvailable: result.python_available,
      unslothAvailable: result.unsloth_available,
      cudaAvailable: result.cuda_available,
      vramGb: result.vram_gb,
    };
  } catch (err) {
    logger.warn('loraTrainingService: env check failed', { err });
    return {
      pythonAvailable: false,
      unslothAvailable: false,
      cudaAvailable: false,
      vramGb: 0,
      message: String(err),
    };
  }
}
