import { createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit';

export interface FeatureFlagsState {
  enableOllama: boolean;
  enablePerformanceBudgets: boolean;
  enableVisualRegression: boolean;
  /** When false, manuscript Codex extraction listener is skipped (default: true). */
  enableCodexAutoTracking: boolean;
  /** Story Bible Light: graph edges + consistency hints in Codex (default: false). */
  enableStoryBibleAdvanced: boolean;
}

const FEATURE_FLAGS_STORAGE_KEY = 'storycraft-feature-flags';

const defaultFeatureFlagsState: FeatureFlagsState = {
  enableOllama: false,
  enablePerformanceBudgets: false,
  enableVisualRegression: false,
  enableCodexAutoTracking: true,
  enableStoryBibleAdvanced: false,
};

const loadFeatureFlagsState = (): FeatureFlagsState => {
  if (typeof window === 'undefined') {
    return defaultFeatureFlagsState;
  }

  try {
    const stored = localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    if (!stored) {
      return defaultFeatureFlagsState;
    }

    const parsed = JSON.parse(stored) as Partial<FeatureFlagsState>;
    return { ...defaultFeatureFlagsState, ...parsed };
  } catch {
    return defaultFeatureFlagsState;
  }
};

const saveFeatureFlagsState = (state: FeatureFlagsState) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be blocked or unavailable.
  }
};

const initialState: FeatureFlagsState = loadFeatureFlagsState();

const featureFlagsSlice = createSlice({
  name: 'featureFlags',
  initialState,
  reducers: {
    setFeatureFlags(_state, action: PayloadAction<FeatureFlagsState>) {
      return action.payload;
    },
    setEnableOllama(state, action: PayloadAction<boolean>) {
      state.enableOllama = action.payload;
    },
    setEnablePerformanceBudgets(state, action: PayloadAction<boolean>) {
      state.enablePerformanceBudgets = action.payload;
    },
    setEnableVisualRegression(state, action: PayloadAction<boolean>) {
      state.enableVisualRegression = action.payload;
    },
    setEnableCodexAutoTracking(state, action: PayloadAction<boolean>) {
      state.enableCodexAutoTracking = action.payload;
    },
    setEnableStoryBibleAdvanced(state, action: PayloadAction<boolean>) {
      state.enableStoryBibleAdvanced = action.payload;
    },
  },
});

export const featureFlagsActions = featureFlagsSlice.actions;
export const selectFeatureFlags = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags;
export const selectEnableOllama = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableOllama;
export const selectEnablePerformanceBudgets = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enablePerformanceBudgets;
export const selectEnableVisualRegression = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableVisualRegression;
export const selectEnableCodexAutoTracking = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableCodexAutoTracking;
export const selectEnableStoryBibleAdvanced = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableStoryBibleAdvanced;

export const featureFlagsPersistenceMiddleware: Middleware<unknown, unknown> =
  (storeAPI) => (next) => (action) => {
    const result = next(action);
    const actionType = (action as { type?: string }).type;

    if (typeof actionType === 'string' && actionType.startsWith('featureFlags/')) {
      const state = storeAPI.getState() as { featureFlags: FeatureFlagsState };
      saveFeatureFlagsState(state.featureFlags);
    }

    return result;
  };

export default featureFlagsSlice.reducer;
