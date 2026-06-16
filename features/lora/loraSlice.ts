/**
 * LoRA Fine-Tuning Redux Slice
 * QNBS-v3: State machine for the personalized writer-style model module (v2.0-alpha).
 *          Follows proForgeSlice.ts patterns exactly. NOT wrapped with redux-undo.
 */

import { createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit';
import type {
  DatasetEntry,
  LoraActiveView,
  LoraAdapter,
  LoraState,
  LoraWizardStep,
  PresetId,
  StyleConsistencyReport,
  TrainingRun,
  TrainingStatus,
} from './types';
import { HYPERPARAM_PRESETS } from './types';

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

const initialState: LoraState = {
  adapters: [],
  activeAdapterId: null,
  currentRun: null,
  runHistory: [],
  datasets: {},
  isBuilding: false,
  isMerging: false,
  isEvaluating: false,
  activeView: 'library',
  wizardStep: 'model',
  selectedPresetId: 'writer-style-light',
  selectedBaseModel: '',
  error: null,
  lastEvaluation: null,
  onboardingDismissed: false,
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const loraSlice = createSlice({
  name: 'lora',
  initialState,
  reducers: {
    // -----------------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------------

    setActiveView(state, action: PayloadAction<LoraActiveView>) {
      state.activeView = action.payload;
    },

    setWizardStep(state, action: PayloadAction<LoraWizardStep>) {
      state.wizardStep = action.payload;
    },

    setSelectedPreset(state, action: PayloadAction<PresetId>) {
      state.selectedPresetId = action.payload;
      const preset = HYPERPARAM_PRESETS.find((p) => p.id === action.payload);
      if (preset) {
        // Auto-populate wizard defaults when preset changes
        state.error = null;
      }
    },

    setSelectedBaseModel(state, action: PayloadAction<string>) {
      state.selectedBaseModel = action.payload;
    },

    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },

    clearError(state) {
      state.error = null;
    },

    // QNBS-v3: centralized onboarding-seen state (was component-level localStorage) — persisted.
    dismissOnboarding(state) {
      state.onboardingDismissed = true;
    },

    // -----------------------------------------------------------------------
    // Adapter management
    // -----------------------------------------------------------------------

    adaptersLoaded(state, action: PayloadAction<LoraAdapter[]>) {
      state.adapters = action.payload;
      state.activeAdapterId = action.payload.find((a) => a.isActive)?.id ?? state.activeAdapterId;
    },

    adapterSaved(state, action: PayloadAction<LoraAdapter>) {
      const idx = state.adapters.findIndex((a) => a.id === action.payload.id);
      if (idx >= 0) {
        state.adapters[idx] = action.payload;
      } else {
        state.adapters.push(action.payload);
      }
    },

    adapterDeleted(state, action: PayloadAction<string>) {
      state.adapters = state.adapters.filter((a) => a.id !== action.payload);
      if (state.activeAdapterId === action.payload) {
        state.activeAdapterId = null;
      }
    },

    setActiveAdapter(state, action: PayloadAction<string | null>) {
      state.activeAdapterId = action.payload;
      // Update isActive flag on all adapters
      for (const adapter of state.adapters) {
        adapter.isActive = adapter.id === action.payload;
      }
    },

    adapterMerged(state, action: PayloadAction<LoraAdapter>) {
      const idx = state.adapters.findIndex((a) => a.id === action.payload.id);
      if (idx >= 0) {
        state.adapters[idx] = { ...action.payload, status: 'merged' };
      }
      state.isMerging = false;
    },

    setIsMerging(state, action: PayloadAction<boolean>) {
      state.isMerging = action.payload;
    },

    // -----------------------------------------------------------------------
    // Dataset
    // -----------------------------------------------------------------------

    setIsBuilding(state, action: PayloadAction<boolean>) {
      state.isBuilding = action.payload;
    },

    datasetBuilt(state, action: PayloadAction<{ projectId: string; entries: DatasetEntry[] }>) {
      state.datasets[action.payload.projectId] = action.payload.entries;
      state.isBuilding = false;
    },

    datasetCleared(state, action: PayloadAction<string>) {
      delete state.datasets[action.payload];
    },

    // -----------------------------------------------------------------------
    // Training
    // -----------------------------------------------------------------------

    trainingStarted(
      state,
      action: PayloadAction<
        Pick<TrainingRun, 'id' | 'projectId' | 'baseModelId' | 'presetId' | 'totalEpochs'>
      >,
    ) {
      const run: TrainingRun = {
        ...action.payload,
        status: 'training',
        progressPercent: 0,
        currentEpoch: 0,
        currentLoss: 0,
        lossHistory: [],
        startedAt: Date.now(),
      };
      state.currentRun = run;
      state.error = null;
    },

    trainingProgress(
      state,
      action: PayloadAction<{
        progressPercent: number;
        currentEpoch: number;
        currentLoss: number;
      }>,
    ) {
      if (!state.currentRun) return;
      state.currentRun.progressPercent = action.payload.progressPercent;
      state.currentRun.currentEpoch = action.payload.currentEpoch;
      state.currentRun.currentLoss = action.payload.currentLoss;
      state.currentRun.lossHistory = [...state.currentRun.lossHistory, action.payload.currentLoss];
    },

    trainingStatusChanged(state, action: PayloadAction<TrainingStatus>) {
      if (!state.currentRun) return;
      state.currentRun.status = action.payload;
    },

    trainingCompleted(state, action: PayloadAction<{ outputAdapterId: string }>) {
      if (!state.currentRun) return;
      state.currentRun.status = 'completed';
      state.currentRun.progressPercent = 100;
      state.currentRun.completedAt = Date.now();
      state.currentRun.outputAdapterId = action.payload.outputAdapterId;
      state.runHistory = [state.currentRun, ...state.runHistory].slice(0, 20);
      state.currentRun = null;
    },

    trainingFailed(state, action: PayloadAction<string>) {
      if (!state.currentRun) return;
      state.currentRun.status = 'failed';
      state.currentRun.errorMessage = action.payload;
      state.runHistory = [state.currentRun, ...state.runHistory].slice(0, 20);
      state.currentRun = null;
      state.error = action.payload;
    },

    trainingAborted(state) {
      if (!state.currentRun) return;
      state.currentRun.status = 'aborted';
      state.runHistory = [state.currentRun, ...state.runHistory].slice(0, 20);
      state.currentRun = null;
    },

    // -----------------------------------------------------------------------
    // Evaluation
    // -----------------------------------------------------------------------

    setIsEvaluating(state, action: PayloadAction<boolean>) {
      state.isEvaluating = action.payload;
    },

    evaluationCompleted(state, action: PayloadAction<StyleConsistencyReport>) {
      state.lastEvaluation = action.payload;
      state.isEvaluating = false;
    },

    // -----------------------------------------------------------------------
    // Hydration (persistence restore)
    // -----------------------------------------------------------------------

    hydrateLoraState(state, action: PayloadAction<Partial<LoraState>>) {
      return { ...state, ...action.payload };
    },
  },
});

export const loraActions = loraSlice.actions;
export const {
  setActiveView,
  setWizardStep,
  setSelectedPreset,
  setSelectedBaseModel,
  setError,
  clearError,
  dismissOnboarding,
  adaptersLoaded,
  adapterSaved,
  adapterDeleted,
  setActiveAdapter,
  adapterMerged,
  setIsMerging,
  setIsBuilding,
  datasetBuilt,
  datasetCleared,
  trainingStarted,
  trainingProgress,
  trainingStatusChanged,
  trainingCompleted,
  trainingFailed,
  trainingAborted,
  setIsEvaluating,
  evaluationCompleted,
  hydrateLoraState,
} = loraSlice.actions;

export default loraSlice.reducer;

// ---------------------------------------------------------------------------
// Persistence middleware (localStorage key: 'worldscript-lora')
// ---------------------------------------------------------------------------

const LORA_STORAGE_KEY = 'worldscript-lora';

type StateWithLora = { lora: LoraState };

// QNBS-v3: State typed as unknown (Redux store constraint); cast inside where lora shape is needed.
export const loraPersistenceMiddleware: Middleware<Record<string, never>, unknown> =
  (store) => (next) => (action) => {
    const result = next(action);
    const act = action as Record<string, unknown>;
    if (
      typeof act['type'] === 'string' &&
      act['type'].startsWith('lora/') &&
      !act['type'].includes('trainingProgress') // skip high-frequency updates
    ) {
      try {
        const state = store.getState() as StateWithLora;
        const toPersist: Partial<LoraState> = {
          adapters: state.lora.adapters,
          activeAdapterId: state.lora.activeAdapterId,
          runHistory: state.lora.runHistory,
          selectedPresetId: state.lora.selectedPresetId,
          selectedBaseModel: state.lora.selectedBaseModel,
          onboardingDismissed: state.lora.onboardingDismissed,
        };
        localStorage.setItem(LORA_STORAGE_KEY, JSON.stringify(toPersist));
      } catch {
        // localStorage quota exceeded — not critical
      }
    }
    return result;
  };

export function loadPersistedLoraState(): Partial<LoraState> | null {
  try {
    const raw = localStorage.getItem(LORA_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<LoraState>;
  } catch {
    return null;
  }
}
