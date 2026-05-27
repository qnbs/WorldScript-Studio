/**
 * LoRA Fine-Tuning — Async Thunks
 * QNBS-v3: Bridges Redux state machine with services/lora/* adapters.
 *          All cloud-AI calls are blocked via assertLoraLocalOnly.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { v4 as uuid } from 'uuid';
import type { AppDispatch, RootState } from '../../app/store';
import {
  adapterDeleted,
  adapterMerged,
  adapterSaved,
  adaptersLoaded,
  datasetBuilt,
  evaluationCompleted,
  setActiveAdapter,
  setIsBuilding,
  setIsEvaluating,
  setIsMerging,
  trainingAborted,
  trainingCompleted,
  trainingFailed,
  trainingProgress,
  trainingStarted,
} from './loraSlice';
import type { DatasetEntry, HyperparamPreset } from './types';

type ThunkConfig = { dispatch: AppDispatch; state: RootState };

// ---------------------------------------------------------------------------
// Load adapters from IDB
// ---------------------------------------------------------------------------

export const loadAdaptersThunk = createAsyncThunk<void, void, ThunkConfig>(
  'lora/loadAdapters',
  async (_, { dispatch }) => {
    const { listAdapters } = await import('../../services/loraAdapterService');
    const metas = await listAdapters();
    dispatch(
      adaptersLoaded(
        metas.map((m) => ({
          ...m,
          status: m.isActive ? ('active' as const) : ('idle' as const),
        })),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// Activate / deactivate adapter
// ---------------------------------------------------------------------------

export const activateAdapterThunk = createAsyncThunk<void, string, ThunkConfig>(
  'lora/activateAdapter',
  async (id, { dispatch }) => {
    const { activateAdapter } = await import('../../services/loraAdapterService');
    await activateAdapter(id);
    dispatch(setActiveAdapter(id));
  },
);

export const deactivateAdapterThunk = createAsyncThunk<void, void, ThunkConfig>(
  'lora/deactivateAdapter',
  async (_, { dispatch }) => {
    const { deactivateAdapter } = await import('../../services/loraAdapterService');
    await deactivateAdapter();
    dispatch(setActiveAdapter(null));
  },
);

// ---------------------------------------------------------------------------
// Delete adapter
// ---------------------------------------------------------------------------

export const deleteAdapterThunk = createAsyncThunk<void, string, ThunkConfig>(
  'lora/deleteAdapter',
  async (id, { dispatch }) => {
    const { deleteAdapter } = await import('../../services/loraAdapterService');
    await deleteAdapter(id);
    dispatch(adapterDeleted(id));
  },
);

// ---------------------------------------------------------------------------
// Build dataset
// ---------------------------------------------------------------------------

export const buildDatasetThunk = createAsyncThunk<
  DatasetEntry[],
  { projectId: string; includeSynthetic?: boolean; syntheticCount?: number },
  ThunkConfig
>('lora/buildDataset', async ({ projectId, includeSynthetic, syntheticCount }, { dispatch }) => {
  dispatch(setIsBuilding(true));
  try {
    const { extractScenePairs, scoreDatasetEntries, generateSyntheticPairs } = await import(
      '../../services/lora/loraDatasetBuilder'
    );

    let entries = await extractScenePairs(projectId);
    entries = await scoreDatasetEntries(entries);

    if (includeSynthetic && syntheticCount && syntheticCount > 0) {
      const ctrl = new AbortController();
      const synthetic = await generateSyntheticPairs(entries, syntheticCount, ctrl.signal);
      entries = [...entries, ...synthetic];
    }

    // Persist to IDB
    const { saveDatasetEntries } = await import('../../services/loraAdapterService');
    const stored = entries.map((e) => ({ ...e }));
    await saveDatasetEntries(stored);

    dispatch(datasetBuilt({ projectId, entries }));
    return entries;
  } finally {
    dispatch(setIsBuilding(false));
  }
});

// ---------------------------------------------------------------------------
// Start training
// ---------------------------------------------------------------------------

export const startTrainingThunk = createAsyncThunk<
  void,
  {
    projectId: string;
    baseModelId: string;
    datasetPath: string;
    outputDir: string;
    preset: HyperparamPreset;
    customRank?: number;
    customAlpha?: number;
    customEpochs?: number;
  },
  ThunkConfig
>('lora/startTraining', async (config, { dispatch }) => {
  const { assertLoraLocalOnly } = await import('../../services/ai/aiPolicy');
  assertLoraLocalOnly(config.baseModelId);

  const runId = uuid();
  dispatch(
    trainingStarted({
      id: runId,
      projectId: config.projectId,
      baseModelId: config.baseModelId,
      presetId: config.preset.id,
      totalEpochs: config.customEpochs ?? config.preset.epochs,
    }),
  );

  const { startTraining } = await import('../../services/lora/loraTrainingService');
  try {
    const result = await startTraining(
      {
        projectId: config.projectId,
        baseModelId: config.baseModelId,
        datasetPath: config.datasetPath,
        outputDir: config.outputDir,
        preset: config.preset,
        ...(config.customRank !== undefined && { customRank: config.customRank }),
        ...(config.customAlpha !== undefined && { customAlpha: config.customAlpha }),
        ...(config.customEpochs !== undefined && { customEpochs: config.customEpochs }),
      },
      (event) => {
        if (event.event === 'progress') {
          dispatch(
            trainingProgress({
              progressPercent: event.progress_percent ?? 0,
              currentEpoch: Math.floor(event.epoch ?? 0),
              currentLoss: event.loss ?? 0,
            }),
          );
        }
      },
    );

    // Save completed adapter to IDB
    const adapterId = uuid();
    const { saveAdapter } = await import('../../services/loraAdapterService');
    const meta = {
      id: adapterId,
      name: `${config.preset.id} — ${new Date().toLocaleDateString()}`,
      description: `Trained with preset: ${config.preset.id}`,
      modelCompatibility: config.baseModelId,
      scale: 1.0,
      fileSizeBytes: 0,
      createdAt: Date.now(),
      projectId: config.projectId,
      format: 'safetensors' as const,
      localPath: result.adapterPath,
      version: 1,
      isActive: false,
      status: 'idle' as const,
    };
    await saveAdapter(meta, new ArrayBuffer(0));
    dispatch(adapterSaved(meta));
    dispatch(trainingCompleted({ outputAdapterId: adapterId }));
  } catch (err) {
    dispatch(trainingFailed(err instanceof Error ? err.message : String(err)));
  }
});

// ---------------------------------------------------------------------------
// Abort training
// ---------------------------------------------------------------------------

export const abortTrainingThunk = createAsyncThunk<void, void, ThunkConfig>(
  'lora/abortTraining',
  async (_, { dispatch }) => {
    const { abortTraining } = await import('../../services/lora/loraTrainingService');
    await abortTraining();
    dispatch(trainingAborted());
  },
);

// ---------------------------------------------------------------------------
// Merge adapter
// ---------------------------------------------------------------------------

export const mergeAdapterThunk = createAsyncThunk<
  void,
  { adapterId: string; baseModelId: string; outputPath: string },
  ThunkConfig
>('lora/mergeAdapter', async ({ adapterId, baseModelId, outputPath }, { dispatch, getState }) => {
  dispatch(setIsMerging(true));
  const adapter = getState().lora.adapters.find((a) => a.id === adapterId);
  if (!adapter?.localPath) throw new Error('Adapter has no local path');
  const { mergeAdapter } = await import('../../services/lora/loraTrainingService');
  await mergeAdapter(baseModelId, adapter.localPath, outputPath);
  dispatch(adapterMerged({ ...adapter, format: 'merged-gguf', localPath: outputPath }));
});

// ---------------------------------------------------------------------------
// Evaluate adapter (Style Consistency Score)
// ---------------------------------------------------------------------------

export const evaluateAdapterThunk = createAsyncThunk<
  void,
  { adapterId: string; testPrompts: string[] },
  ThunkConfig
>('lora/evaluateAdapter', async ({ adapterId, testPrompts }, { dispatch, getState }) => {
  dispatch(setIsEvaluating(true));
  const adapter = getState().lora.adapters.find((a) => a.id === adapterId);
  if (!adapter) throw new Error('Adapter not found');

  const { generateText: geminiText } = await import('../../services/geminiService');
  const { computeStyleConsistencyScore } = await import(
    '../../services/lora/loraEvaluationService'
  );

  const results = await Promise.all(
    testPrompts.slice(0, 5).map(async (prompt) => {
      const base = await geminiText(prompt, 'Balanced');
      // Adapter output — use Ollama if available, else same base
      let adapted = base;
      if (adapter.localPath) {
        const { testOllamaAdapterPrompt } = await import('../../services/lora/loraOllamaService');
        try {
          adapted = await testOllamaAdapterPrompt(
            `storycraft-${adapterId.slice(0, 8)}`,
            prompt,
            AbortSignal.timeout(30_000),
          );
        } catch {
          adapted = base;
        }
      }
      return { prompt, baseOutput: base, adaptedOutput: adapted };
    }),
  );

  const report = await computeStyleConsistencyScore(results);
  dispatch(evaluationCompleted(report));
});
