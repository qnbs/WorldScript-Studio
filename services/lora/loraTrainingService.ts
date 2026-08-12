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

/** Returns true only when a real process for the current run was found and confirmed terminated. */
export async function abortTraining(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await tauriInvoke<boolean>('abort_lora_training');
  } catch (err) {
    logger.warn('loraTrainingService: abort failed', { err });
    // QNBS-v3: A native cancellation failure must reach the thunk so UI state never claims an orphan process stopped.
    throw err;
  }
}

export async function mergeAdapter(
  baseModel: string,
  adapterPath: string,
  outputPath: string,
): Promise<void> {
  if (!isTauri()) throw new Error('Merge requires the desktop app.');
  // QNBS-v3: Tauri's #[tauri::command] macro binds top-level JS invoke keys as camelCase by default (no rename_all override on merge_lora) — snake_case keys here fail arg binding.
  await tauriInvoke('merge_lora', {
    baseModel,
    adapterPath,
    outputPath,
  });
}

export async function generateOllamaModelfile(
  baseModel: string,
  adapterPath: string,
  name: string,
): Promise<string> {
  if (isTauri()) {
    // QNBS-v3: same Tauri default-camelCase arg binding as merge_lora — no rename_all override.
    return tauriInvoke<string>('generate_ollama_modelfile', {
      baseModel,
      adapterPath,
      name,
    });
  }
  // Web fallback — generate template locally
  return `FROM ${baseModel}\nADAPTER ${adapterPath}\nSYSTEM "You are ${name}, a writing assistant trained on this author's style. Match their voice precisely."\n`;
}

export interface TrainingEnvironment {
  pythonAvailable: boolean;
  unslothAvailable: boolean;
  cudaAvailable: boolean;
  vramGb: number;
  pythonVersion: string;
  pythonPath?: string;
  lastError?: string;
  message?: string;
}

type NativeTrainingEnvironment = {
  python_available: boolean;
  unsloth_available: boolean;
  cuda_available: boolean;
  vram_gb: number;
  python_version: string;
  python_path?: string | null;
  last_error?: string | null;
};

function fromNativeEnvironment(result: NativeTrainingEnvironment): TrainingEnvironment {
  return {
    pythonAvailable: result.python_available,
    unslothAvailable: result.unsloth_available,
    cudaAvailable: result.cuda_available,
    vramGb: result.vram_gb,
    pythonVersion: result.python_version,
    ...(result.python_path ? { pythonPath: result.python_path } : {}),
    ...(result.last_error ? { lastError: result.last_error } : {}),
  };
}

/** Check if training environment is available (Python + Unsloth). Tauri-only. */
export async function checkTrainingEnvironment(): Promise<TrainingEnvironment> {
  if (!isTauri()) {
    return {
      pythonAvailable: false,
      unslothAvailable: false,
      cudaAvailable: false,
      vramGb: 0,
      pythonVersion: '',
      message: 'Training is only available in the desktop app.',
    };
  }
  try {
    const result = await tauriInvoke<NativeTrainingEnvironment>('check_lora_environment');
    return fromNativeEnvironment(result);
  } catch (err) {
    logger.warn('loraTrainingService: env check failed', { err });
    return {
      pythonAvailable: false,
      unslothAvailable: false,
      cudaAvailable: false,
      vramGb: 0,
      pythonVersion: '',
      message: String(err),
    };
  }
}

/** Ask the user to choose a Python executable, then let the desktop backend verify and persist it. */
export async function selectPythonExecutable(): Promise<TrainingEnvironment | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    directory: false,
  });
  if (typeof selected !== 'string') return null;
  // QNBS-v3: set_lora_python_path has no rename_all override, so Tauri's default camelCase arg binding requires `pythonPath` here — `python_path` fails invocation before the command runs.
  const result = await tauriInvoke<NativeTrainingEnvironment>('set_lora_python_path', {
    pythonPath: selected,
  });
  return fromNativeEnvironment(result);
}
