/**
 * Central test-matrix for feature-flag combinations used in E2E parametrized tests.
 *
 * QNBS-v3: Before v1.21, flags were off by default → CI only tested the "no-features" path.
 * This matrix makes the flag dimensions explicit and ensures critical code paths are covered
 * regardless of what the slice's runtime defaults happen to be at any given time.
 *
 * Rule: any test that relies on a specific flag being on/off MUST use setFeatureFlags()
 * with the relevant entry from this matrix (or define its own slice).
 */

/** Subset of featureFlagsSlice keys used in E2E coverage. */
export type E2EFlagKey =
  | 'enableProForge'
  | 'enableVoiceSupport'
  | 'enableVoiceWasm'
  | 'enableDuckDbAnalytics'
  | 'enableLoraAdapters'
  | 'enablePluginSystem'
  | 'enableIdbAtRestEncryption'
  | 'enableAdaptiveAiEngine'
  | 'enableWorkerBusV2'
  | 'enableGlobalCopilot';

export interface TestConfig {
  name: string;
  /** A short description of what this config exercises — used in test.describe labels. */
  description: string;
  flags: Partial<Record<E2EFlagKey, boolean>>;
}

/**
 * Canonical test configurations. Each entry maps to one beforeEach call in a
 * parametrized suite. Add configs here; all suites that iterate over this list
 * automatically gain coverage for the new config on the next CI run.
 */
export const testConfigurations: readonly TestConfig[] = [
  {
    name: 'defaults',
    description: 'Runtime slice defaults — what new users see on first launch',
    flags: {},
  },
  {
    name: 'proforge-enabled',
    description: 'ProForge 8-stage agentic editing pipeline',
    flags: { enableProForge: true },
  },
  {
    name: 'voice-web-speech',
    description: 'Voice commands using the Web Speech API (zero-download fallback)',
    flags: { enableVoiceSupport: true, enableVoiceWasm: false },
  },
  {
    name: 'voice-wasm',
    description: 'Voice commands with Whisper WASM + Silero VAD offline engine',
    flags: { enableVoiceSupport: true, enableVoiceWasm: true },
  },
  {
    name: 'analytics-full',
    description: 'DuckDB analytics + adaptive AI engine',
    flags: { enableDuckDbAnalytics: true, enableAdaptiveAiEngine: true },
  },
  {
    name: 'encryption-on',
    description: 'IDB at-rest encryption enabled',
    flags: { enableIdbAtRestEncryption: true },
  },
  {
    name: 'workerbus-v2',
    description: 'WorkerBus v2 orchestration layer active',
    flags: { enableWorkerBusV2: true },
  },
  {
    name: 'global-copilot',
    description: 'Global AI Copilot live assistant launcher visible',
    flags: { enableGlobalCopilot: true },
  },
] as const;

/**
 * Critical-risk combinations: pairs of flags whose interaction has the most
 * potential for regressions. Run at minimum the "critical" subset in the deep
 * coverage CI job.
 */
export const criticalCombinations: readonly TestConfig[] = [
  {
    name: 'proforge-workerbus',
    description: 'ProForge + WorkerBus v2 (agentic tasks route through WorkerBus)',
    flags: { enableProForge: true, enableWorkerBusV2: true },
  },
  {
    name: 'voice-analytics',
    description: 'Voice + DuckDB analytics (both WASM-heavy features concurrent)',
    flags: {
      enableVoiceSupport: true,
      enableVoiceWasm: true,
      enableDuckDbAnalytics: true,
    },
  },
  {
    name: 'proforge-encryption',
    description: 'ProForge pipeline with IDB at-rest encryption (storage read/write under crypto)',
    flags: { enableProForge: true, enableIdbAtRestEncryption: true },
  },
] as const;
