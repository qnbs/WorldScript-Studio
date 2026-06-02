import { createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit';

export interface FeatureFlagsState {
  // QNBS-v3: enableCodexAutoTracking promoted to permanent core behaviour (v1.20).
  // QNBS-v3: enableCrossProjectSearch promoted to permanent core behaviour (v1.8).
  // QNBS-v3: enablePlotBoardV2 retired — v1 board removed in v1.6; flag had no effect.
  // QNBS-v3: enableCloudSync retired — Cloud Sync UI is not yet built; the toggle was a no-op.
  /** Story Bible Light: graph edges + consistency hints in Codex (default: false). */
  enableStoryBibleAdvanced: boolean;
  /** Research binder sidebar in Manuscript (default: false). */
  enableBinderResearch: boolean;
  /** Guided compile wizard on Export view (default: false). */
  enableCompileWizard: boolean;
  /** Experimental: Project health insights from dashboard (default: false). */
  enableProjectHealthScore: boolean;
  /** Experimental: About-page runtime diagnostics (default: false). */
  enableAppHealthPanel: boolean;
  /** DuckDB-WASM analytics side-car: OPFS-backed query engine for dashboards (default: false). */
  enableDuckDbAnalytics: boolean;
  /** Story Objects & Groups inventory view — v1.7 Bibisco-depth feature (default: false). */
  enableObjectsGroups: boolean;
  /** Enhanced Mind Maps — SVG canvas, 5 node shapes, entity linking (default: false). */
  enableMindMaps: boolean;
  /** Character Interviews v2 — archetype-based AI interview sessions (default: false). */
  enableCharacterInterviews: boolean;
  /** RTL layout foundation — sets html[dir]=rtl for manual testing; gated until RTL locales land (default: false). */
  enableRtlLayout: boolean;
  /** LoRA adapter inference — load .safetensors adapters for local WebLLM models (default: false). */
  enableLoraAdapters: boolean;
  /** Plugin system v0.1 — ESM-based extensions with sandboxed capability API (default: false). */
  enablePluginSystem: boolean;
  /** Voice Full Support — opt-in voice command, dictation and audio navigation (default: false). */
  enableVoiceSupport: boolean;
  /** ProForge Ultimate Author Pipeline — agentic 8-stage manuscript pipeline (default: false). */
  enableProForge: boolean;
  /** IDB at-rest encryption — AES-256-GCM passphrase-derived key for all manuscript stores (default: false). */
  enableIdbAtRestEncryption: boolean;
  /** Voice WASM engines — local Whisper STT + Silero VAD via ONNX; no cloud audio routing (default: false). */
  enableVoiceWasm: boolean;
  /** Adaptive AI Engine — runtime device profiler + automatic backend/model selection (default: false). */
  enableAdaptiveAiEngine: boolean;
  /** WebNN inference — NPU/GPU acceleration via ONNX Runtime Web WebNN execution provider (default: false). */
  enableWebnnInference: boolean;
  /** Compute Shaders — custom WGSL kernels for RAG, plot-board, voice preprocessing (default: false). */
  enableComputeShaders: boolean;
  /** WorkerBus v2 — unified worker orchestration backbone (default: false). */
  enableWorkerBusV2: boolean;
  /** Rust Compute — offload heavy tasks to Tauri Rust TaskSupervisor (default: true in Tauri, false in web). */
  enableRustCompute: boolean;
}

const FEATURE_FLAGS_STORAGE_KEY = 'storycraft-feature-flags';

const defaultFeatureFlagsState: FeatureFlagsState = {
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  enableAppHealthPanel: false,
  // QNBS-v3: DuckDB-WASM analytics is experimental; off by default until P1 analytics features land
  enableDuckDbAnalytics: false,
  // QNBS-v3: v1.7 Objects inventory — off by default; feature-flagged for staged rollout.
  enableObjectsGroups: false,
  // QNBS-v3: v1.7 Mind Maps — off by default; requires Objects to be useful.
  enableMindMaps: false,
  // QNBS-v3: v1.7 Character Interviews — off by default; requires AI key to be useful.
  enableCharacterInterviews: false,
  // QNBS-v3: RTL foundation — off by default; flip to test mirrored layout before RTL locales ship.
  enableRtlLayout: false,
  // QNBS-v3: LoRA adapter inference — off by default; browser LoRA is experimental (no training, inference only).
  enableLoraAdapters: false,
  // QNBS-v3: Plugin system v0.1 — off by default; sandboxed API contract is stable, loader is not yet wired.
  enablePluginSystem: false,
  // QNBS-v3: Voice Full Support — off by default; requires download of WASM voice models and microphone permission.
  enableVoiceSupport: false,
  // QNBS-v3: ProForge Pipeline — off by default; major feature requiring agentic AI setup.
  enableProForge: false,
  // QNBS-v3: IDB at-rest encryption — off by default; requires passphrase setup in Settings > Privacy.
  enableIdbAtRestEncryption: false,
  // QNBS-v3: Voice WASM engines — off by default; ~40 MB Whisper model download on first use.
  enableVoiceWasm: false,
  // QNBS-v3: Adaptive AI Engine — off by default; requires benchmark calibration before enabling.
  enableAdaptiveAiEngine: false,
  // QNBS-v3: WebNN inference — off by default; WebNN spec is still evolving (2026).
  enableWebnnInference: false,
  // QNBS-v3: Compute Shaders — off by default; WGSL kernels require GPU compatibility testing.
  enableComputeShaders: false,
  // QNBS-v3: WorkerBus v2 — off by default; Phase 2 runtime wiring lands in services/workerBusManager.ts.
  enableWorkerBusV2: false,
  // QNBS-v3: Rust Compute — off by default; Phase 2 HybridRouter routes to Tauri TaskSupervisor when true.
  enableRustCompute: false,
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
    setEnableAppHealthPanel(state, action: PayloadAction<boolean>) {
      state.enableAppHealthPanel = action.payload;
    },
    setEnableDuckDbAnalytics(state, action: PayloadAction<boolean>) {
      state.enableDuckDbAnalytics = action.payload;
    },
    setEnableObjectsGroups(state, action: PayloadAction<boolean>) {
      state.enableObjectsGroups = action.payload;
    },
    setEnableMindMaps(state, action: PayloadAction<boolean>) {
      state.enableMindMaps = action.payload;
    },
    setEnableCharacterInterviews(state, action: PayloadAction<boolean>) {
      state.enableCharacterInterviews = action.payload;
    },
    setEnableRtlLayout(state, action: PayloadAction<boolean>) {
      state.enableRtlLayout = action.payload;
    },
    setEnableLoraAdapters(state, action: PayloadAction<boolean>) {
      state.enableLoraAdapters = action.payload;
    },
    setEnablePluginSystem(state, action: PayloadAction<boolean>) {
      state.enablePluginSystem = action.payload;
    },
    setEnableVoiceSupport(state, action: PayloadAction<boolean>) {
      state.enableVoiceSupport = action.payload;
    },
    setEnableProForge(state, action: PayloadAction<boolean>) {
      state.enableProForge = action.payload;
    },
    setEnableIdbAtRestEncryption(state, action: PayloadAction<boolean>) {
      state.enableIdbAtRestEncryption = action.payload;
    },
    setEnableVoiceWasm(state, action: PayloadAction<boolean>) {
      state.enableVoiceWasm = action.payload;
    },
    setEnableAdaptiveAiEngine(state, action: PayloadAction<boolean>) {
      state.enableAdaptiveAiEngine = action.payload;
    },
    setEnableWebnnInference(state, action: PayloadAction<boolean>) {
      state.enableWebnnInference = action.payload;
    },
    setEnableComputeShaders(state, action: PayloadAction<boolean>) {
      state.enableComputeShaders = action.payload;
    },
    setEnableWorkerBusV2(state, action: PayloadAction<boolean>) {
      state.enableWorkerBusV2 = action.payload;
    },
    setEnableRustCompute(state, action: PayloadAction<boolean>) {
      state.enableRustCompute = action.payload;
    },
  },
});

export const featureFlagsActions = featureFlagsSlice.actions;
export const selectFeatureFlags = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags;
export const selectEnableStoryBibleAdvanced = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableStoryBibleAdvanced;
export const selectEnableBinderResearch = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableBinderResearch;
export const selectEnableCompileWizard = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableCompileWizard;
export const selectEnableProjectHealthScore = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableProjectHealthScore;
export const selectEnableAppHealthPanel = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableAppHealthPanel;
export const selectEnableDuckDbAnalytics = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableDuckDbAnalytics;
export const selectEnableObjectsGroups = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableObjectsGroups;
export const selectEnableMindMaps = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableMindMaps;
export const selectEnableCharacterInterviews = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableCharacterInterviews;
export const selectEnableRtlLayout = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableRtlLayout;
export const selectEnableLoraAdapters = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableLoraAdapters;
export const selectEnablePluginSystem = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enablePluginSystem;
export const selectEnableVoiceSupport = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableVoiceSupport;
export const selectEnableProForge = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableProForge;
export const selectEnableIdbAtRestEncryption = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableIdbAtRestEncryption;
export const selectEnableVoiceWasm = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableVoiceWasm;
export const selectEnableAdaptiveAiEngine = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableAdaptiveAiEngine;
export const selectEnableWebnnInference = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableWebnnInference;
export const selectEnableComputeShaders = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableComputeShaders;
export const selectEnableWorkerBusV2 = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableWorkerBusV2;
export const selectEnableRustCompute = (state: { featureFlags: FeatureFlagsState }) =>
  state.featureFlags.enableRustCompute;

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
