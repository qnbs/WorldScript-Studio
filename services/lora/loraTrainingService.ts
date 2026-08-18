/**
 * LoRA Training Service
 * QNBS-v3: Desktop-platform-adapter bridge for Python/Unsloth training + progress streaming.
 *          Gracefully degrades on web build (returns isDesktopOnly: true).
 */

import type { LoraTrainingEnvironmentResult } from '@domain/desktop-contracts';
import { v4 as uuid } from 'uuid';
import type { HyperparamPreset } from '../../features/lora/types';
import { desktopPlatform } from '../desktopPlatform';
import { logger } from '../logger';

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
  if (!desktopPlatform.runtime.isDesktop) {
    throw new Error('LoRA training requires the WorldScript Studio desktop app.');
  }
  const runId = uuid();
  logger.info('loraTrainingService: starting training run', { runId, preset: config.preset.id });

  const unlisten = await desktopPlatform.tasks.onLoraTrainingProgress((payload) => {
    onProgress(payload as TrainingProgressEvent);
  });

  try {
    await desktopPlatform.tasks.trainLora({
      model_id: config.baseModelId,
      dataset_path: config.datasetPath,
      output_dir: config.outputDir,
      preset: config.preset.id,
      rank: config.customRank ?? null,
      alpha: config.customAlpha ?? null,
      epochs: config.customEpochs ?? null,
      max_seq_len: config.customMaxSeqLen ?? null,
    });

    const adapterPath = `${config.outputDir}/adapter`;
    const ggufPath = `${config.outputDir}/adapter.gguf`;
    return { runId, adapterPath, ggufPath };
  } finally {
    unlisten();
  }
}

// QNBS-v3: three-way, not boolean — 'pending_start_cancelled' means the run was still starting (no process yet) but the cancellation was recorded and the pending native call will reject with training_cancelled, unlike 'nothing_to_cancel' which is a true no-op.
export type AbortTrainingOutcome = 'confirmed' | 'pending_start_cancelled' | 'nothing_to_cancel';

export async function abortTraining(): Promise<AbortTrainingOutcome> {
  if (!desktopPlatform.runtime.isDesktop) return 'nothing_to_cancel';
  try {
    return await desktopPlatform.tasks.abortLoraTraining();
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
  if (!desktopPlatform.runtime.isDesktop) throw new Error('Merge requires the desktop app.');
  await desktopPlatform.tasks.mergeLora({ baseModel, adapterPath, outputPath });
}

export async function generateOllamaModelfile(
  baseModel: string,
  adapterPath: string,
  name: string,
): Promise<string> {
  if (desktopPlatform.runtime.isDesktop) {
    return desktopPlatform.tasks.generateOllamaModelfile({ baseModel, adapterPath, name });
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

function fromNativeEnvironment(result: LoraTrainingEnvironmentResult): TrainingEnvironment {
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

/** Check if training environment is available (Python + Unsloth). Desktop-only. */
export async function checkTrainingEnvironment(): Promise<TrainingEnvironment> {
  if (!desktopPlatform.runtime.isDesktop) {
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
    const result = await desktopPlatform.tasks.checkLoraEnvironment();
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
  if (!desktopPlatform.runtime.isDesktop) return null;
  const selected = await desktopPlatform.dialogs.openFilePicker({
    multiple: false,
    directory: false,
  });
  if (typeof selected !== 'string') return null;
  const result = await desktopPlatform.tasks.setLoraPythonPath(selected);
  return fromNativeEnvironment(result);
}
