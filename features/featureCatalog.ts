/**
 * Living Feature Catalog — single source of truth for all feature-flag-gated capabilities.
 *
 * QNBS-v3: Derived from featureFlagsSlice.ts but enriched with:
 *  - maturity tier (stable | beta | experimental | stub | ghost)
 *  - default state
 *  - gate locations (where the flag is actually checked at runtime)
 *  - dependencies (other flags or services required)
 *  - known drifts (parity issues tracked here until fixed)
 *
 * Run `pnpm exec tsx scripts/audit-feature-parity.ts` to validate against live code.
 */

import type { FeatureFlagsState } from './featureFlags/featureFlagsSlice';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeatureMaturity =
  | 'stable' // Default-on; production quality; full test coverage
  | 'beta' // Default-off; feature-complete; UX polish pending
  | 'experimental' // Default-off; working but not ready for wide use
  | 'stub' // Default-off; service exists, not wired end-to-end
  | 'ghost'; // Defined in slice but UI/handler/service all missing

export type FeatureTier =
  | 'core' // Fundamental writing features
  | 'ai' // AI-powered capabilities
  | 'collab' // Real-time collaboration
  | 'analytics' // Data analysis and insights
  | 'privacy' // Encryption and data sovereignty
  | 'voice' // Voice input/output
  | 'pipeline' // ProForge agentic pipeline
  | 'personalization' // LoRA, fine-tuning
  | 'extensions' // Plugin system
  | 'sync' // Cloud synchronization
  | 'i18n'; // Internationalization

export interface FeatureGate {
  /** File path where the flag is read */
  file: string;
  /** Brief description of what the gate does */
  description: string;
}

export interface KnownDrift {
  severity: 'critical' | 'warning' | 'info';
  description: string;
  /** Which files need to change to fix this */
  fix: string;
}

export interface FeatureCatalogEntry {
  /** Matches the key in FeatureFlagsState */
  flagKey: keyof FeatureFlagsState;
  /** Human-readable name */
  name: string;
  /** One-line description of what this feature does */
  description: string;
  /** Maturity classification */
  maturity: FeatureMaturity;
  /** Feature domain */
  tier: FeatureTier;
  /** Default value in featureFlagsSlice.ts */
  defaultOn: boolean;
  /** Where the flag is actually enforced at runtime */
  gateLocations: FeatureGate[];
  /** Other flags that must be on for this feature to work */
  requires?: Array<keyof FeatureFlagsState>;
  /** Services/files that implement the feature */
  implementedIn: string[];
  /** Known parity drifts — empty means fully consistent */
  drifts: KnownDrift[];
  /** ROADMAP milestone when this feature targets stable */
  roadmapTarget?: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const FEATURE_CATALOG: FeatureCatalogEntry[] = [
  // ── Core Features ─────────────────────────────────────────────────────────

  {
    flagKey: 'enableCodexAutoTracking',
    name: 'Codex Auto-Tracking',
    description:
      'Automatically extracts character names, world details, and story objects from the manuscript into the Codex on save.',
    maturity: 'stable',
    tier: 'core',
    defaultOn: true,
    gateLocations: [
      {
        file: 'app/listenerMiddleware.ts:219',
        description: 'Skip Codex extraction listener when off',
      },
    ],
    implementedIn: ['app/listenerMiddleware.ts', 'services/codexService.ts'],
    drifts: [],
  },

  {
    flagKey: 'enableStoryBibleAdvanced',
    name: 'Story Bible Advanced Mode',
    description:
      'Enables graph-edge extraction and consistency hints in the Codex panel, turning it into a lightweight story bible.',
    maturity: 'experimental',
    tier: 'core',
    defaultOn: false,
    gateLocations: [
      {
        file: 'app/listenerMiddleware.ts:247',
        description: 'Passes advanced:true to Codex extraction when on',
      },
    ],
    implementedIn: ['app/listenerMiddleware.ts', 'services/codexService.ts'],
    drifts: [
      {
        severity: 'warning',
        description:
          'No UI change is gated on this flag — only extraction behaviour changes. User cannot observe the difference from Settings.',
        fix: 'Add a visible "Advanced" badge or additional Codex panel columns when flag is on',
      },
    ],
  },

  {
    flagKey: 'enableBinderResearch',
    name: 'Research Binder',
    description:
      'Research binder sidebar panel inside ManuscriptView for collecting web clips, notes, and references.',
    maturity: 'beta',
    tier: 'core',
    defaultOn: false,
    gateLocations: [
      {
        file: 'components/ManuscriptView.tsx:27',
        description: 'Conditionally renders binder sidebar and tabs',
      },
    ],
    implementedIn: ['components/manuscript/BinderPanel.tsx', 'hooks/useManuscriptView.ts'],
    drifts: [],
  },

  {
    flagKey: 'enableCompileWizard',
    name: 'Compile Wizard',
    description:
      'Step-by-step guided compile wizard on the Export view for configuring output format, trim, and style.',
    maturity: 'experimental',
    tier: 'core',
    defaultOn: false,
    gateLocations: [
      { file: 'components/ExportView.tsx:507', description: 'Renders CompileWizardModal when on' },
    ],
    implementedIn: ['components/ExportView.tsx', 'components/CompileWizardModal.tsx'],
    drifts: [],
  },

  {
    flagKey: 'enableProjectHealthScore',
    name: 'Project Health Score',
    description:
      'Displays a composite health score on the Dashboard based on word count, scene structure, and character consistency.',
    maturity: 'experimental',
    tier: 'analytics',
    defaultOn: false,
    gateLocations: [
      { file: 'components/Dashboard.tsx:402', description: 'Renders HealthScoreCard when on' },
      {
        file: 'services/commands/commandDefinitions.tsx:269',
        description: 'Command palette entry conditional',
      },
    ],
    implementedIn: ['components/Dashboard.tsx', 'services/commands/commandDefinitions.tsx'],
    drifts: [],
  },

  {
    flagKey: 'enableCrossProjectSearch',
    name: 'Cross-Project Search',
    description:
      'Search panel and fuzzy-rank index that spans all saved projects, enabling concept retrieval across your library.',
    maturity: 'stable',
    tier: 'core',
    defaultOn: true,
    gateLocations: [
      { file: 'components/CrossProjectSearchPanel.tsx:133', description: 'Hides panel when off' },
      {
        file: 'app/listenerMiddleware.ts:133',
        description: 'Skips cross-project index update on save',
      },
      {
        file: 'services/commands/commandDefinitions.tsx:287',
        description: 'Command palette entry conditional',
      },
    ],
    implementedIn: [
      'services/crossProjectIndexService.ts',
      'services/crossProjectSearchService.ts',
      'components/CrossProjectSearchPanel.tsx',
    ],
    drifts: [],
  },

  {
    flagKey: 'enableAppHealthPanel',
    name: 'App Health Panel',
    description:
      'About-page runtime diagnostics: memory usage, IDB health, WebGPU status, audio context state.',
    maturity: 'experimental',
    tier: 'analytics',
    defaultOn: false,
    gateLocations: [
      {
        file: 'components/settings/GeneralSections.tsx:314',
        description: 'Renders GpuMetricsPanel section when on',
      },
    ],
    implementedIn: ['components/settings/GpuMetricsPanel.tsx'],
    drifts: [],
  },

  {
    flagKey: 'enablePlotBoardV2',
    name: 'Plot Board v2',
    description:
      'Full canvas plot board with free-form pan/zoom, SVG tension curve, subplot swimlanes, and minimap.',
    maturity: 'stable',
    tier: 'core',
    defaultOn: true,
    gateLocations: [
      // QNBS-v3: No runtime gate found — Plot Board v2 IS the board; v1 code was removed.
      // Flag should be deprecated or used to toggle legacy swimlane-only mode.
    ],
    implementedIn: ['components/SceneBoardView.tsx', 'features/plotBoard/plotBoardSlice.ts'],
    drifts: [
      {
        severity: 'warning',
        description:
          'Flag exists and is togglable but no runtime code reads it — v1 board was removed.',
        fix: 'Either deprecate the flag (remove from FeatureFlagsSection) or use it to toggle a legacy swimlane-only mode',
      },
    ],
  },

  {
    flagKey: 'enableDuckDbAnalytics',
    name: 'DuckDB Analytics',
    description:
      'OPFS-backed DuckDB-WASM analytics engine for fast story queries, RAG vector search, and scene timeline analytics.',
    maturity: 'experimental',
    tier: 'analytics',
    defaultOn: false,
    gateLocations: [
      { file: 'hooks/useDuckDb.ts:59', description: 'Skips DuckDB init when off' },
      {
        file: 'hooks/useAnalytics.ts:50',
        description: 'Skips 4 parallel analytics queries when off',
      },
      {
        file: 'components/manuscript/ReferencePanelView.tsx:181',
        description: 'Conditionally shows DuckDB query tab',
      },
    ],
    implementedIn: ['services/duckdb/', 'workers/duckdbWorker.ts', 'hooks/useDuckDb.ts'],
    drifts: [],
  },

  {
    flagKey: 'enableObjectsGroups',
    name: 'Story Objects & Groups',
    description:
      'Inventory view for props, weapons, vehicles, artifacts, documents, and place items with group tagging.',
    maturity: 'beta',
    tier: 'core',
    defaultOn: false,
    gateLocations: [],
    implementedIn: [
      'components/ObjectsView.tsx',
      'hooks/useObjectsView.ts',
      'features/project/projectSlice.ts',
    ],
    drifts: [
      {
        severity: 'critical',
        description:
          'App.tsx renders ObjectsView at case "objects" with NO feature flag gate — view is accessible regardless of flag state.',
        fix: 'Add `if (!featureFlags.enableObjectsGroups) return <Dashboard ... />;` in App.tsx case "objects"',
      },
    ],
    roadmapTarget: 'v1.7 / PLANbib Phase 1',
  },

  {
    flagKey: 'enableMindMaps',
    name: 'Enhanced Mind Maps',
    description:
      'SVG mind-map canvas with 5 node shapes, entity-linking to characters/scenes, and multi-map management.',
    maturity: 'beta',
    tier: 'core',
    defaultOn: false,
    gateLocations: [],
    implementedIn: [
      'components/MindMapView.tsx',
      'components/mind-map/',
      'hooks/useMindMapView.ts',
    ],
    drifts: [
      {
        severity: 'critical',
        description:
          'App.tsx renders MindMapView at case "mindmap" with NO feature flag gate — always accessible.',
        fix: 'Add `if (!featureFlags.enableMindMaps) return <Dashboard ... />;` in App.tsx case "mindmap"',
      },
    ],
    roadmapTarget: 'v1.7 / PLANbib Phase 2',
  },

  {
    flagKey: 'enableCharacterInterviews',
    name: 'Character Interviews v2',
    description:
      'Archetype-based AI interview sessions for character development with streaming responses.',
    maturity: 'experimental',
    tier: 'ai',
    defaultOn: false,
    gateLocations: [
      {
        file: 'hooks/useCharacterInterviewsView.ts:39',
        description: 'Returns isEnabled=false to hook consumers when off',
      },
    ],
    implementedIn: [
      'components/CharacterInterviewsView.tsx',
      'hooks/useCharacterInterviewsView.ts',
      'features/project/thunks/interviewThunks.ts',
    ],
    drifts: [
      {
        severity: 'warning',
        description:
          'CharacterInterviewsView component mounts regardless — only hook reports isEnabled=false. The component should gate its own render.',
        fix: 'Add App.tsx route guard or early-return in CharacterInterviewsView when isEnabled=false',
      },
    ],
    roadmapTarget: 'v1.7 / PLANbib Phase 3',
  },

  {
    flagKey: 'enableRtlLayout',
    name: 'RTL Layout Beta',
    description:
      'Sets html[dir]=rtl for testing right-to-left layout. Requires Arabic or Hebrew locale content to be useful.',
    maturity: 'stub',
    tier: 'i18n',
    defaultOn: false,
    gateLocations: [
      { file: 'App.tsx:271', description: 'Sets document.documentElement.dir when on' },
    ],
    implementedIn: ['App.tsx', 'locales/ar/', 'locales/he/'],
    drifts: [],
    roadmapTarget: 'v2.0 — requires community translation',
  },

  {
    flagKey: 'enableCloudSync',
    name: 'Cloud Sync (Cloudflare R2)',
    description:
      'AES-256-GCM E2E-encrypted project sync to a user-controlled Cloudflare R2 bucket.',
    maturity: 'stub',
    tier: 'sync',
    defaultOn: false,
    gateLocations: [],
    implementedIn: [
      'services/cloudSync/cloudSyncBackend.ts',
      'services/cloudSync/cloudSyncClient.ts',
      'services/cloudSync/cloudSyncEncryption.ts',
    ],
    drifts: [
      {
        severity: 'critical',
        description:
          'Service files say "gated behind enableCloudSync" in comments but no code reads the flag at runtime — cloud sync could theoretically be called without user consent.',
        fix: 'Add `if (!getState().featureFlags.enableCloudSync) throw new Error("Cloud Sync not enabled")` guard in cloudSyncBackend.ts',
      },
    ],
    roadmapTarget: 'v2.0',
  },

  {
    flagKey: 'enableLoraAdapters',
    name: 'LoRA Adapter Inference',
    description:
      'Load pre-trained .safetensors adapters for style personalization via Ollama model-tag override.',
    maturity: 'experimental',
    tier: 'personalization',
    defaultOn: false,
    gateLocations: [
      {
        file: 'components/settings/LoraAdapterSection.tsx:23',
        description: 'Shows flag-gate message when off',
      },
      { file: 'hooks/useLoraView.ts:50', description: 'Returns isEnabled=false when off' },
    ],
    implementedIn: ['services/loraAdapterService.ts', 'services/lora/', 'features/lora/'],
    drifts: [
      {
        severity: 'warning',
        description:
          "`selectActiveLoraOllamaTag` selector (loraSelectors.ts:51) is defined but never imported or used — no production code reads the active adapter's ollamaModelTag to inject it into AI calls.",
        fix: 'Import selectActiveLoraOllamaTag in useStoryCraftAI.ts or writingThunks.ts and pass result as loraModelPath in AIRequestOptions when enableLoraAdapters is on',
      },
    ],
    roadmapTarget: 'v2.0',
  },

  {
    flagKey: 'enablePluginSystem',
    name: 'Plugin System v0.1',
    description:
      'ESM-based extension system with Zod-validated descriptors and sandboxed capability API.',
    maturity: 'beta',
    tier: 'extensions',
    defaultOn: false,
    gateLocations: [
      {
        file: 'components/settings/PluginsSection.tsx:16',
        description: 'Shows flag-gate message when off',
      },
    ],
    implementedIn: ['services/pluginRegistry.ts', 'services/plugins/'],
    drifts: [
      {
        severity: 'warning',
        description:
          '`pluginRegistry.execute()` and `loadPlugin()` are callable without checking the flag — only the settings UI is gated.',
        fix: 'Add `if (!selectEnablePluginSystem(store.getState())) throw new Error("Plugin system disabled")` in PluginRegistry.execute()',
      },
    ],
  },

  {
    flagKey: 'enableVoiceSupport',
    name: 'Voice Commands & Dictation',
    description:
      'Full voice command system with STT, TTS, push-to-talk, intent engine, and dictation mode.',
    maturity: 'experimental',
    tier: 'voice',
    defaultOn: false,
    gateLocations: [{ file: 'App.tsx:568', description: 'Renders VoiceControlPanel when on' }],
    implementedIn: ['services/voice/', 'hooks/useVoice.ts', 'hooks/usePushToTalk.ts'],
    drifts: [],
  },

  {
    flagKey: 'enableProForge',
    name: 'ProForge Pipeline',
    description:
      '8-stage agentic manuscript editing pipeline (intake → structural → lineProse → copyEdit → proof → production → publishing → analytics) with Human-in-the-Loop gates.',
    maturity: 'experimental',
    tier: 'pipeline',
    defaultOn: false,
    gateLocations: [
      {
        file: 'components/writing/WriterViewUI.tsx:23',
        description: 'Shows ProForge panel button when on',
      },
    ],
    implementedIn: ['features/proForge/', 'services/proForge/', 'components/proForge/'],
    drifts: [
      {
        severity: 'critical',
        description:
          'No `case "enableProForge"` in useSettingsView.ts handleSettingChange() — toggling in UI does nothing (falls to default logger.warn).',
        fix: 'Add `case "enableProForge": dispatch(featureFlagsActions.setEnableProForge(Boolean(value))); break;` in hooks/useSettingsView.ts',
      },
    ],
  },

  {
    flagKey: 'enableIdbAtRestEncryption',
    name: 'IDB At-Rest Encryption',
    description:
      'AES-256-GCM passphrase-derived encryption for all IndexedDB manuscript stores. PBKDF2 (600k iterations, SHA-256).',
    maturity: 'ghost',
    tier: 'privacy',
    defaultOn: false,
    gateLocations: [],
    implementedIn: ['services/storage/storageEncryptionService.ts'],
    drifts: [
      {
        severity: 'critical',
        description:
          'GHOST FLAG: defined in slice with selector, but (1) no i18n key in any locale, (2) not in FeatureFlagsSection.tsx, (3) no handler in useSettingsView.ts, (4) storageEncryptionService.ts never reads the flag.',
        fix: 'Phase 3 deliverable: add i18n key, UI toggle (with warning banner), useSettingsView handler, and initIdbEncryption() call gated on flag in dbService',
      },
    ],
    roadmapTarget: 'Phase 3 / IDB Encryption UX complete',
  },

  {
    flagKey: 'enableVoiceWasm',
    name: 'Voice WASM Engine',
    description:
      'Whisper.cpp WASM STT + Silero VAD v4 via ONNX Runtime Web — fully offline, no cloud audio routing.',
    maturity: 'stub',
    tier: 'voice',
    defaultOn: false,
    requires: ['enableVoiceSupport'],
    gateLocations: [
      {
        file: 'hooks/useVoice.ts:29',
        description: 'Passes enableVoiceWasm to voice service config',
      },
      { file: 'services/voice/sttEngine.ts:158', description: 'Selects WasmSttEngine when on' },
      { file: 'services/voice/vadEngine.ts:83', description: 'Selects SileroVadEngine when on' },
    ],
    implementedIn: ['services/voice/wasmSttEngine.ts', 'services/voice/sileroVadEngine.ts'],
    drifts: [
      {
        severity: 'critical',
        description:
          'No `case "enableVoiceWasm"` in useSettingsView.ts — toggling in UI falls to default logger.warn.',
        fix: 'Add `case "enableVoiceWasm": dispatch(featureFlagsActions.setEnableVoiceWasm(Boolean(value))); break;` in hooks/useSettingsView.ts',
      },
      {
        severity: 'warning',
        description:
          'SileroVadEngine.isAvailable() returns false unconditionally (Phase 3 not yet wired). WasmSttEngine is wired but model download UI is not connected.',
        fix: 'Phase 3: connect WasmSttEngine.initialize() to a model download progress modal',
      },
    ],
    roadmapTarget: 'Phase 3',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Returns all flags with at least one critical drift */
export const getCriticalDrifts = () =>
  FEATURE_CATALOG.filter((e) => e.drifts.some((d) => d.severity === 'critical'));

/** Returns all flags of a given maturity */
export const getByMaturity = (m: FeatureMaturity) =>
  FEATURE_CATALOG.filter((e) => e.maturity === m);

/** Returns a catalog entry by flag key */
export const getCatalogEntry = (key: keyof FeatureFlagsState) =>
  FEATURE_CATALOG.find((e) => e.flagKey === key);

/** Returns all flags that have drifts */
export const getAllDrifts = () => FEATURE_CATALOG.filter((e) => e.drifts.length > 0);
