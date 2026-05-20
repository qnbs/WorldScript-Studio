import { createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit';

export interface FeatureFlagsState {
  /** When false, manuscript Codex extraction listener is skipped (default: true). */
  enableCodexAutoTracking: boolean;
  /** Story Bible Light: graph edges + consistency hints in Codex (default: false). */
  enableStoryBibleAdvanced: boolean;
  /** Research binder sidebar in Manuscript (default: false). */
  enableBinderResearch: boolean;
  /** Guided compile wizard on Export view (default: false). */
  enableCompileWizard: boolean;
  /** Experimental: Project health insights from dashboard (default: false). */
  enableProjectHealthScore: boolean;
  /** Experimental: Search across projects (default: false). */
  enableCrossProjectSearch: boolean;
  /** Experimental: About-page runtime diagnostics (default: false). */
  enableAppHealthPanel: boolean;
  /** Plot-Board v2: free-form canvas, SVG connections, tension curve (default: true). */
  enablePlotBoardV2: boolean;
  /** DuckDB-WASM analytics side-car: OPFS-backed query engine for dashboards (default: false). */
  enableDuckDbAnalytics: boolean;
}

const FEATURE_FLAGS_STORAGE_KEY = 'storycraft-feature-flags';

const defaultFeatureFlagsState: FeatureFlagsState = {
  enableCodexAutoTracking: true,
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  // QNBS-v3: v1 panel ready; promote from experimental to default-on
  enableCrossProjectSearch: true,
  enableAppHealthPanel: false,
  // QNBS-v3: Plot-Board v2 is the new default scene board mode in v1.6
  enablePlotBoardV2: true,
  // QNBS-v3: DuckDB-WASM analytics is experimental; off by default until P1 analytics features land
  enableDuckDbAnalytics: false,
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
    setEnableCodexAutoTracking(state, action: PayloadAction<boolean>) {
      state.enableCodexAutoTracking = action.payload;
    },
    setEnableStoryBibleAdvanced(state, action: PayloadAction<boolean>) {
      state.enableStoryBibleAdvanced = action.payload;
    },
    setEnableBinderResearch(state, action: PayloadAction<boolean>) {
      state.enableBinderResearch = action.payload;
    },
    setEnableCompileWizard(state, action: PayloadAction<boolean>) {
      state.enableCompileWizard = action.payload;
    },
    setEnableProjectHealthScore(state, action: PayloadAction<boolean>) {
      state.enableProjectHealthScore = action.payload;
    },
    setEnableCrossProjectSearch(state, action: PayloadAction<boolean>) {
      state.enableCrossProjectSearch = action.payload;
    },
    setEnableAppHealthPanel(state, action: PayloadAction<boolean>) {
      state.enableAppHealthPanel = action.payload;
    },
    setEnablePlotBoardV2(state, action: PayloadAction<boolean>) {
      state.enablePlotBoardV2 = action.payload;
    },
    setEnableDuckDbAnalytics(state, action: PayloadAction<boolean>) {
      state.enableDuckDbAnalytics = action.payload;
    },
  },
});

export const featureFlagsActions = featureFlagsSlice.actions;
export const selectFeatureFlags = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags;
export const selectEnableCodexAutoTracking = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableCodexAutoTracking;
export const selectEnableStoryBibleAdvanced = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableStoryBibleAdvanced;
export const selectEnableBinderResearch = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableBinderResearch;
export const selectEnableCompileWizard = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableCompileWizard;
export const selectEnableProjectHealthScore = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableProjectHealthScore;
export const selectEnableCrossProjectSearch = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableCrossProjectSearch;
export const selectEnableAppHealthPanel = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableAppHealthPanel;
export const selectEnablePlotBoardV2 = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enablePlotBoardV2;
export const selectEnableDuckDbAnalytics = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableDuckDbAnalytics;

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
