/**
 * LoRA Fine-Tuning — Typed Memoized Selectors
 * QNBS-v3: All selectors typed against RootState via the lora slice.
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../../app/store';
import { HYPERPARAM_PRESETS } from './types';

const selectLoraSlice = (state: RootState) => state.lora;

export const selectLoraAdapters = createSelector(selectLoraSlice, (s) => s.adapters);

export const selectActiveAdapterId = createSelector(selectLoraSlice, (s) => s.activeAdapterId);

export const selectActiveAdapter = createSelector(
  selectLoraSlice,
  (s) => s.adapters.find((a) => a.id === s.activeAdapterId) ?? null,
);

export const selectCurrentTrainingRun = createSelector(selectLoraSlice, (s) => s.currentRun);

export const selectRunHistory = createSelector(selectLoraSlice, (s) => s.runHistory);

export const selectLoraDatasets = createSelector(selectLoraSlice, (s) => s.datasets);

export const selectDatasetForProject = (projectId: string) =>
  createSelector(selectLoraSlice, (s) => s.datasets[projectId] ?? []);

export const selectIsBuilding = createSelector(selectLoraSlice, (s) => s.isBuilding);
export const selectIsMerging = createSelector(selectLoraSlice, (s) => s.isMerging);
export const selectIsEvaluating = createSelector(selectLoraSlice, (s) => s.isEvaluating);

export const selectLoraActiveView = createSelector(selectLoraSlice, (s) => s.activeView);
export const selectLoraOnboardingDismissed = createSelector(
  selectLoraSlice,
  (s) => s.onboardingDismissed,
);
export const selectWizardStep = createSelector(selectLoraSlice, (s) => s.wizardStep);

export const selectSelectedPresetId = createSelector(selectLoraSlice, (s) => s.selectedPresetId);

export const selectSelectedPreset = createSelector(
  selectLoraSlice,
  (s) => HYPERPARAM_PRESETS.find((p) => p.id === s.selectedPresetId) ?? HYPERPARAM_PRESETS[0],
);

export const selectSelectedBaseModel = createSelector(selectLoraSlice, (s) => s.selectedBaseModel);

export const selectLoraError = createSelector(selectLoraSlice, (s) => s.error);

export const selectLastEvaluation = createSelector(selectLoraSlice, (s) => s.lastEvaluation);

// QNBS-v3: C-3 — returns the Ollama model tag for the active LoRA adapter, or null.
// When non-null and enableLoraAdapters is on, this tag should override the base model in Ollama calls.
export const selectActiveLoraOllamaTag = createSelector(selectLoraSlice, (s): string | null => {
  const adapter = s.adapters.find((a) => a.id === s.activeAdapterId);
  return adapter?.ollamaModelTag ?? null;
});

export const selectIsTraining = createSelector(
  selectLoraSlice,
  (s) => s.currentRun?.status === 'training' || s.currentRun?.status === 'preparing',
);

export const selectAdaptersByProject = (projectId: string) =>
  createSelector(selectLoraSlice, (s) => s.adapters.filter((a) => a.projectId === projectId));
