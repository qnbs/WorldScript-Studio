/**
 * Exhaustive feature-test coverage authority (#709).
 *
 * QNBS-v3: A production feature flag can be correctly wired in application code while remaining
 * unqualified at product/E2E level — the flag existing is not proof anyone decided how it should
 * be tested. This registry is the single place that decision lives, keyed directly from the
 * production `FeatureFlagsState` so it cannot silently drift from the flag set it describes.
 *
 * `satisfies Record<keyof FeatureFlagsState, FeatureTestCoverage>` gives two invariants for free,
 * at compile time, with no runtime script needed:
 *   - every current flag has an entry (a missing key is a type error);
 *   - a retired flag left behind here is a type error too (excess-property checking on the
 *     object-literal position, same as `audit-feature-parity.ts` derives defaultOn from the slice
 *     rather than hand-duplicating it).
 * `scripts/check-feature-test-coverage.ts` covers what TypeScript cannot: that every referenced
 * spec path actually exists on disk, and that REQUIRED_FUNCTIONAL_E2E evidence sits in the
 * required (non-advisory) E2E lane.
 *
 * This file is test-only — nothing under tests/ is part of the production Vite bundle.
 */
import type { FeatureFlagsState } from '../../../features/featureFlags/featureFlagsSlice';

export type FeatureTestDisposition =
  /** A dedicated E2E spec seeds the flag and asserts real feature behavior (not just mount), and that spec runs in the required (non-advisory) CI lane. */
  | 'REQUIRED_FUNCTIONAL_E2E'
  /** A dedicated Settings-contract test proves the toggle's default/persistence/dependency-gating UX, beyond the generic catalog-driven FeatureFlagsSection coverage every flag already gets. */
  | 'REQUIRED_SETTINGS_CONTRACT'
  /** Vitest unit/integration coverage exercises the gated hook/service/component; no dedicated E2E exists or is warranted yet. */
  | 'UNIT_OR_INTEGRATION_ONLY'
  /** Only meaningful inside the Tauri desktop runtime; browser E2E is explicitly not applicable. */
  | 'DESKTOP_ONLY_QUALIFICATION'
  /** Requires a real external/paid/native runtime; qualified nightly or manually, never in mandatory PR CI. */
  | 'ADVISORY_REAL_RUNTIME'
  /** Flag exists but gates nothing browser/product-visible (rare; prefer one of the tiers above whenever any evidence exists). */
  | 'NOT_APPLICABLE';

export interface FeatureTestCoverage {
  disposition: FeatureTestDisposition;
  runtimes: Array<'web' | 'pwa' | 'desktop'>;
  /**
   * Repo-relative spec/test file paths declared as this flag's required evidence.
   * `check-feature-test-coverage.ts` machine-checks only that these paths EXIST and, for
   * REQUIRED_FUNCTIONAL_E2E, that they sit in the required (non-advisory) E2E lane — it does not
   * parse spec content, so it cannot prove a path's assertions actually exercise this specific flag.
   * That semantic correctness is proven by the spec itself plus human/bot review at PR time.
   */
  blockingSpecs: string[];
  /** Additional non-blocking evidence (e.g. the deep/advisory matrix canary, or weaker-signal unit coverage). */
  advisorySpecs?: string[];
  /** Whether a user-reachable Settings toggle is expected to exist for this flag. */
  settingsToggleRequired: boolean;
  /** Whether the flag's OFF state (not just ON) needs its own explicit assertion somewhere in blockingSpecs. */
  offStateRequired: boolean;
  /** Mandatory whenever disposition is weaker than REQUIRED_FUNCTIONAL_E2E for a FEATURE_CATALOG riskLevel:'high' flag — explains the gap instead of leaving it silent. */
  rationale?: string;
}

const FEATURE_TEST_COVERAGE_LITERAL = {
  // ── Core / low-risk, generic-settings-toggle features ─────────────────────
  enableStoryBibleAdvanced: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/listenerMiddleware.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
    rationale:
      'Low risk; the catalog itself notes no UI change is gated on this flag, only Codex extraction behavior — nothing distinct for E2E to click on.',
  },
  enableBinderResearch: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useManuscriptView.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableCompileWizard: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useExportView.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableProjectHealthScore: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/Dashboard.test.tsx'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableAppHealthPanel: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/settings/GpuMetricsPanel.test.tsx'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableObjectsGroups: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useObjectsView.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableMindMaps: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useMindMapView.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableCharacterInterviews: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useCharacterInterviewsView.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableRtlLayout: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/rtlFoundation.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
    rationale:
      'Stub maturity — gated until ar/he locales ship real content; the foundation (html[dir]) is unit-tested, no product surface exists yet for E2E to exercise.',
  },

  // ── Dedicated required-CI E2E specs ────────────────────────────────────────
  enableLoraAdapters: {
    disposition: 'REQUIRED_FUNCTIONAL_E2E',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/e2e/lora-wizard.spec.ts'],
    advisorySpecs: ['tests/unit/lora/useLoraView.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
  },
  enableVoiceSupport: {
    disposition: 'REQUIRED_FUNCTIONAL_E2E',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/e2e/voice-flags.spec.ts'],
    advisorySpecs: ['tests/unit/hooks/useVoice.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
  },
  enableProForge: {
    disposition: 'REQUIRED_FUNCTIONAL_E2E',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/e2e/proforge-flags.spec.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
  },
  enableVoiceWasm: {
    disposition: 'REQUIRED_FUNCTIONAL_E2E',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/e2e/voice-flags.spec.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
    rationale:
      'Depends on enableVoiceSupport (see featureCatalog requires); same spec covers both.',
  },
  enableGlobalCopilot: {
    disposition: 'REQUIRED_FUNCTIONAL_E2E',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/e2e/copilot-flags.spec.ts'],
    advisorySpecs: ['tests/unit/copilot/useGlobalCopilot.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
  },
  enableBrowserOllama: {
    disposition: 'REQUIRED_FUNCTIONAL_E2E',
    runtimes: ['web', 'pwa'],
    blockingSpecs: ['tests/e2e/browser-ollama-flags.spec.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
    rationale: 'ADR-0017: web/PWA-only experimental path; desktop already reaches Ollama directly.',
  },

  // ── Dedicated (non-generic) Settings-contract flags ────────────────────────
  enablePluginSystem: {
    disposition: 'REQUIRED_SETTINGS_CONTRACT',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: [
      'tests/unit/pluginRegistry.test.ts',
      'tests/unit/plugins/pluginRegistryLoad.test.ts',
    ],
    settingsToggleRequired: true,
    offStateRequired: false,
    rationale:
      'Dedicated toggle in PluginsSection.tsx (hidden from the generic catalog list is not the case here, but the sandboxed-capability contract is proven at the registry/loader level, not via a generic mount smoke).',
  },
  enableIdbAtRestEncryption: {
    disposition: 'REQUIRED_SETTINGS_CONTRACT',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/storage/storageEncryptionService.test.ts'],
    advisorySpecs: ['tests/e2e/deep/feature-flag-matrix.spec.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
    rationale:
      "Hidden from the generic FeatureFlagsSection (HIDDEN_FLAGS) — its real toggle is the PrivacySection passphrase flow, not a plain switch; also in test-matrix's 'encryption-on' and tier:'critical' 'proforge-encryption' configs.",
  },

  // ── Flags in the deep-matrix advisory canary, unit-covered ─────────────────
  enableDuckDbAnalytics: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useDuckDb.test.ts'],
    advisorySpecs: ['tests/e2e/deep/feature-flag-matrix.spec.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
  },
  enableAdaptiveAiEngine: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useAdaptiveAi.test.ts'],
    advisorySpecs: ['tests/e2e/deep/feature-flag-matrix.spec.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
  },
  enableComputeShaders: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/hooks/useAdaptiveAi.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
    rationale:
      'riskLevel:high (WGSL/WebGPU kernels) — the computeShadersEnabled true-path through useAdaptiveAi is now explicitly asserted (previously only the always-false default was exercised anywhere in the suite); no dedicated E2E exists because there is no distinct product-visible surface to seed a flag-off/on comparison against yet.',
  },
  enableWorkerBusV2: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: ['tests/unit/workerBusManager.test.ts'],
    advisorySpecs: ['tests/e2e/deep/feature-flag-matrix.spec.ts'],
    settingsToggleRequired: true,
    offStateRequired: true,
  },
  enableLocalFirstSync: {
    disposition: 'UNIT_OR_INTEGRATION_ONLY',
    runtimes: ['web', 'pwa', 'desktop'],
    blockingSpecs: [
      'tests/unit/localFirst/docBinding.test.ts',
      'tests/unit/localFirst/docPersistence.test.ts',
      'tests/unit/localFirst/docPersistenceErrors.test.ts',
      'tests/unit/localFirst/projectDoc.test.ts',
    ],
    settingsToggleRequired: true,
    offStateRequired: true,
    rationale:
      'riskLevel:high (Yjs shadow projection, B1.1) — no dedicated E2E yet; the Yjs doc-binding/persistence/error-recovery contract is proven at the unit/integration level across four dedicated spec files.',
  },

  // ── Desktop-only qualification ──────────────────────────────────────────────
  enableRustCompute: {
    disposition: 'DESKTOP_ONLY_QUALIFICATION',
    runtimes: ['desktop'],
    blockingSpecs: ['tests/unit/hybridRouter.test.ts'],
    settingsToggleRequired: true,
    offStateRequired: false,
    rationale:
      "Stub maturity, requiresDesktop:true, no browser-reachable production caller for analyzeTextViaRust/diffTextViaRust yet (tracked by audit-feature-parity.ts's own reachability check) — browser E2E is explicitly not applicable.",
  },
} satisfies Record<keyof FeatureFlagsState, FeatureTestCoverage>;

// QNBS-v3: exported through an explicit widened type -- `satisfies` alone keeps each property's narrowest literal type, so `Object.entries()`/indexed access on the raw literal loses optional keys (rationale, advisorySpecs) that only some entries declare.
export const FEATURE_TEST_COVERAGE: Record<keyof FeatureFlagsState, FeatureTestCoverage> =
  FEATURE_TEST_COVERAGE_LITERAL;
