/**
 * useLoraView — Business logic hook for the LoRA Fine-Tuning module.
 * QNBS-v3: Selectors + dispatch + navigation, no rendering logic.
 */

import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../app/hooks';
import { selectEnableLoraAdapters } from '../features/featureFlags/featureFlagsSlice';
import {
  selectActiveAdapter,
  selectActiveAdapterId,
  selectDatasetForProject,
  selectIsBuilding,
  selectIsEvaluating,
  selectIsTraining,
  selectLastEvaluation,
  selectLoraActiveView,
  selectLoraAdapters,
  selectLoraError,
  selectLoraOnboardingDismissed,
  selectRunHistory,
  selectSelectedBaseModel,
  selectSelectedPreset,
  selectSelectedPresetId,
  selectWizardStep,
} from '../features/lora/loraSelectors';
import {
  clearError,
  dismissOnboarding as dismissOnboardingAction,
  setActiveView,
  setSelectedBaseModel,
  setSelectedPreset,
  setWizardStep,
} from '../features/lora/loraSlice';
import {
  abortTrainingThunk,
  activateAdapterThunk,
  buildDatasetThunk,
  deactivateAdapterThunk,
  deleteAdapterThunk,
  evaluateAdapterThunk,
  loadAdaptersThunk,
  mergeAdapterThunk,
  startTrainingThunk,
} from '../features/lora/loraThunks';
import type { LoraActiveView, LoraWizardStep, PresetId } from '../features/lora/types';

export function useLoraView(projectId?: string) {
  const dispatch = useAppDispatch();

  // Selectors
  const isEnabled = useAppSelectorShallow(selectEnableLoraAdapters);
  const adapters = useAppSelectorShallow(selectLoraAdapters);
  const activeAdapterId = useAppSelectorShallow(selectActiveAdapterId);
  const activeAdapter = useAppSelectorShallow(selectActiveAdapter);
  const activeView = useAppSelectorShallow(selectLoraActiveView);
  const wizardStep = useAppSelectorShallow(selectWizardStep);
  const selectedPresetId = useAppSelectorShallow(selectSelectedPresetId);
  const selectedPreset = useAppSelectorShallow(selectSelectedPreset);
  const selectedBaseModel = useAppSelectorShallow(selectSelectedBaseModel);
  const runHistory = useAppSelectorShallow(selectRunHistory);
  const isBuilding = useAppSelectorShallow(selectIsBuilding);
  const isTraining = useAppSelectorShallow(selectIsTraining);
  const isEvaluating = useAppSelectorShallow(selectIsEvaluating);
  const error = useAppSelectorShallow(selectLoraError);
  const lastEvaluation = useAppSelectorShallow(selectLastEvaluation);
  const onboardingDismissed = useAppSelectorShallow(selectLoraOnboardingDismissed);

  // Project-scoped dataset
  const datasetEntries = useAppSelectorShallow(
    projectId ? selectDatasetForProject(projectId) : () => [],
  );

  // Load adapters on mount
  useEffect(() => {
    if (isEnabled) {
      dispatch(loadAdaptersThunk());
    }
  }, [dispatch, isEnabled]);

  // Navigation
  const navigateTo = useCallback(
    (view: LoraActiveView) => dispatch(setActiveView(view)),
    [dispatch],
  );
  const goToWizardStep = useCallback(
    (step: LoraWizardStep) => dispatch(setWizardStep(step)),
    [dispatch],
  );
  const openWizard = useCallback(() => {
    dispatch(setWizardStep('model'));
    dispatch(setActiveView('wizard'));
  }, [dispatch]);

  // Adapter actions
  const activateAdapter = useCallback(
    (id: string) => dispatch(activateAdapterThunk(id)),
    [dispatch],
  );
  const deactivateAdapter = useCallback(() => dispatch(deactivateAdapterThunk()), [dispatch]);
  const deleteAdapter = useCallback((id: string) => dispatch(deleteAdapterThunk(id)), [dispatch]);
  const mergeAdapter = useCallback(
    (adapterId: string, baseModelId: string, outputPath: string) =>
      dispatch(mergeAdapterThunk({ adapterId, baseModelId, outputPath })),
    [dispatch],
  );

  // Dataset
  const buildDataset = useCallback(
    (opts?: { includeSynthetic?: boolean; syntheticCount?: number }) =>
      projectId ? dispatch(buildDatasetThunk({ projectId, ...opts })) : undefined,
    [dispatch, projectId],
  );

  // Training
  const startTraining = useCallback(
    (
      baseModelId: string,
      datasetPath: string,
      outputDir: string,
      customParams?: { rank?: number; alpha?: number; epochs?: number },
    ) => {
      if (!projectId || !selectedPreset) return;
      dispatch(
        startTrainingThunk({
          projectId,
          baseModelId,
          datasetPath,
          outputDir,
          preset: selectedPreset,
          ...(customParams?.rank !== undefined && { customRank: customParams.rank }),
          ...(customParams?.alpha !== undefined && { customAlpha: customParams.alpha }),
          ...(customParams?.epochs !== undefined && { customEpochs: customParams.epochs }),
        }),
      );
    },
    [dispatch, projectId, selectedPreset],
  );
  const abortTraining = useCallback(() => dispatch(abortTrainingThunk()), [dispatch]);

  // Evaluation
  const evaluate = useCallback(
    (adapterId: string, testPrompts: string[]) =>
      dispatch(evaluateAdapterThunk({ adapterId, testPrompts })),
    [dispatch],
  );

  // Preset & model selection
  const selectPreset = useCallback((id: PresetId) => dispatch(setSelectedPreset(id)), [dispatch]);
  const selectBaseModel = useCallback(
    (modelId: string) => dispatch(setSelectedBaseModel(modelId)),
    [dispatch],
  );

  const dismissError = useCallback(() => dispatch(clearError()), [dispatch]);
  const dismissOnboarding = useCallback(() => dispatch(dismissOnboardingAction()), [dispatch]);

  return {
    // State
    isEnabled,
    adapters,
    activeAdapterId,
    activeAdapter,
    activeView,
    wizardStep,
    selectedPresetId,
    selectedPreset,
    selectedBaseModel,
    runHistory,
    datasetEntries,
    isBuilding,
    isTraining,
    isEvaluating,
    error,
    lastEvaluation,
    onboardingDismissed,
    // Actions
    navigateTo,
    goToWizardStep,
    openWizard,
    activateAdapter,
    deactivateAdapter,
    deleteAdapter,
    mergeAdapter,
    buildDataset,
    startTraining,
    abortTraining,
    evaluate,
    selectPreset,
    selectBaseModel,
    dismissError,
    dismissOnboarding,
  };
}
