import { describe, expect, it } from 'vitest';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';
import featureFlagsReducer, {
  featureFlagsActions,
  selectEnableAppHealthPanel,
  selectEnableBinderResearch,
  selectEnableCharacterInterviews,
  selectEnableCompileWizard,
  selectEnableDuckDbAnalytics,
  selectEnableIdbAtRestEncryption,
  selectEnableLoraAdapters,
  selectEnableMindMaps,
  selectEnableObjectsGroups,
  selectEnablePluginSystem,
  selectEnableProForge,
  selectEnableProjectHealthScore,
  selectEnableRtlLayout,
  selectEnableStoryBibleAdvanced,
  selectEnableVoiceSupport,
  selectEnableVoiceWasm,
  selectFeatureFlags,
} from '../../features/featureFlags/featureFlagsSlice';

// ---------------------------------------------------------------------------
// Shared initial state — must include ALL 23 flags (strict TypeScript)
// ---------------------------------------------------------------------------

// QNBS-v3: full feature set on by default EXCEPT the six user-opt-in flags
// (RTL, voice, voice-WASM, ProForge, global copilot, local-first sync). 17 on / 6 off.
const initialState: FeatureFlagsState = {
  enableStoryBibleAdvanced: true,
  enableBinderResearch: true,
  enableCompileWizard: true,
  enableProjectHealthScore: true,
  enableAppHealthPanel: true,
  enableDuckDbAnalytics: true,
  enableObjectsGroups: true,
  enableMindMaps: true,
  enableCharacterInterviews: true,
  enableRtlLayout: false,
  enableLoraAdapters: true,
  enablePluginSystem: true,
  enableVoiceSupport: false,
  // QNBS-v3: ProForge is user-opt-in (experimental, token-heavy) — default off as of v1.24 post-release.
  enableProForge: false,
  enableIdbAtRestEncryption: true,
  enableVoiceWasm: false,
  enableAdaptiveAiEngine: true,
  enableComputeShaders: true,
  enableWorkerBusV2: true,
  enableRustCompute: true,
  enableGlobalCopilot: false,
  enableLocalFirstSync: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('featureFlagsSlice', () => {
  it('should match default feature flag state on init', () => {
    const state = featureFlagsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  it('should toggle individual feature flags', () => {
    const state = featureFlagsReducer(
      undefined,
      featureFlagsActions.setEnableStoryBibleAdvanced(true),
    );
    expect(state.enableStoryBibleAdvanced).toBe(true);
  });

  it('setFeatureFlags replaces entire state', () => {
    const next: FeatureFlagsState = {
      ...initialState,
      enableStoryBibleAdvanced: true,
      enableCompileWizard: true,
    };
    const state = featureFlagsReducer(undefined, featureFlagsActions.setFeatureFlags(next));
    expect(state).toEqual(next);
  });

  it('disabling a flag sets it back to false', () => {
    let state = featureFlagsReducer(
      undefined,
      featureFlagsActions.setEnableStoryBibleAdvanced(true),
    );
    state = featureFlagsReducer(state, featureFlagsActions.setEnableStoryBibleAdvanced(false));
    expect(state.enableStoryBibleAdvanced).toBe(false);
  });

  it('defaults to 16 flags on and 6 user-opt-in flags off', () => {
    const state = featureFlagsReducer(undefined, { type: '@@INIT' });
    const values = Object.values(state);
    // QNBS-v3: WebNN flag (a ghost/no-op toggle) was removed → 22 flags (16 on / 6 opt-in off).
    expect(values).toHaveLength(22);
    expect(values.filter((v) => v === true)).toHaveLength(16);
    expect(values.filter((v) => v === false)).toHaveLength(6);
    // The six opt-in flags are exactly these:
    expect(state.enableRtlLayout).toBe(false);
    expect(state.enableVoiceSupport).toBe(false);
    expect(state.enableVoiceWasm).toBe(false);
    expect(state.enableProForge).toBe(false);
    expect(state.enableGlobalCopilot).toBe(false);
    expect(state.enableLocalFirstSync).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parametrized: each setter enables / disables correctly
// ---------------------------------------------------------------------------

describe('featureFlagsSlice — individual setters', () => {
  // QNBS-v3: action typed with plain {payload,type:string} so every setter is assignable
  // (RTK returns a specific type literal; constraining to one setter's literal breaks the rest)
  const cases: Array<{
    flag: keyof FeatureFlagsState;
    action: (v: boolean) => { payload: boolean; type: string };
    defaultOn: boolean;
  }> = [
    {
      flag: 'enableStoryBibleAdvanced',
      action: featureFlagsActions.setEnableStoryBibleAdvanced,
      defaultOn: true,
    },
    {
      flag: 'enableBinderResearch',
      action: featureFlagsActions.setEnableBinderResearch,
      defaultOn: true,
    },
    {
      flag: 'enableCompileWizard',
      action: featureFlagsActions.setEnableCompileWizard,
      defaultOn: true,
    },
    {
      flag: 'enableProjectHealthScore',
      action: featureFlagsActions.setEnableProjectHealthScore,
      defaultOn: true,
    },
    {
      flag: 'enableAppHealthPanel',
      action: featureFlagsActions.setEnableAppHealthPanel,
      defaultOn: true,
    },
    {
      flag: 'enableDuckDbAnalytics',
      action: featureFlagsActions.setEnableDuckDbAnalytics,
      defaultOn: true,
    },
    {
      flag: 'enableObjectsGroups',
      action: featureFlagsActions.setEnableObjectsGroups,
      defaultOn: true,
    },
    { flag: 'enableMindMaps', action: featureFlagsActions.setEnableMindMaps, defaultOn: true },
    {
      flag: 'enableCharacterInterviews',
      action: featureFlagsActions.setEnableCharacterInterviews,
      defaultOn: true,
    },
    // QNBS-v3: RTL stays false — ar/he locales are stubs only
    { flag: 'enableRtlLayout', action: featureFlagsActions.setEnableRtlLayout, defaultOn: false },
    {
      flag: 'enableLoraAdapters',
      action: featureFlagsActions.setEnableLoraAdapters,
      defaultOn: true,
    },
    {
      flag: 'enablePluginSystem',
      action: featureFlagsActions.setEnablePluginSystem,
      defaultOn: true,
    },
    {
      flag: 'enableVoiceSupport',
      action: featureFlagsActions.setEnableVoiceSupport,
      defaultOn: false,
    },
    // QNBS-v3: ProForge default flipped to off (experimental, token-heavy; user opt-in) — v1.24 post-release.
    { flag: 'enableProForge', action: featureFlagsActions.setEnableProForge, defaultOn: false },
    {
      flag: 'enableIdbAtRestEncryption',
      action: featureFlagsActions.setEnableIdbAtRestEncryption,
      defaultOn: true,
    },
    // QNBS-v3: voice WASM off by default — ~57 MB download; user opt-in
    { flag: 'enableVoiceWasm', action: featureFlagsActions.setEnableVoiceWasm, defaultOn: false },
    // QNBS-v3: global copilot off by default — ambient AI; user opt-in per privacy preference
    {
      flag: 'enableGlobalCopilot',
      action: featureFlagsActions.setEnableGlobalCopilot,
      defaultOn: false,
    },
  ];

  it.each(cases)('$flag default is $defaultOn', ({ flag, defaultOn }) => {
    const state = featureFlagsReducer(undefined, { type: '@@INIT' });
    expect(state[flag]).toBe(defaultOn);
  });

  it.each(cases)('$flag can be set to true via setter', ({ flag, action }) => {
    const state = featureFlagsReducer(undefined, action(true));
    expect(state[flag]).toBe(true);
  });

  it.each(cases)('$flag can be set to false via setter', ({ flag, action }) => {
    const state = featureFlagsReducer(undefined, action(false));
    expect(state[flag]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('featureFlagsSlice — selectors', () => {
  const stateWith = (flags: Partial<FeatureFlagsState>) => ({
    featureFlags: { ...initialState, ...flags },
  });

  it('selectFeatureFlags returns the full flags object', () => {
    const s = stateWith({});
    expect(selectFeatureFlags(s)).toEqual(initialState);
  });

  it.each([
    { selector: selectEnableStoryBibleAdvanced, flag: 'enableStoryBibleAdvanced' as const },
    { selector: selectEnableBinderResearch, flag: 'enableBinderResearch' as const },
    { selector: selectEnableCompileWizard, flag: 'enableCompileWizard' as const },
    { selector: selectEnableProjectHealthScore, flag: 'enableProjectHealthScore' as const },
    { selector: selectEnableAppHealthPanel, flag: 'enableAppHealthPanel' as const },
    { selector: selectEnableDuckDbAnalytics, flag: 'enableDuckDbAnalytics' as const },
    { selector: selectEnableObjectsGroups, flag: 'enableObjectsGroups' as const },
    { selector: selectEnableMindMaps, flag: 'enableMindMaps' as const },
    { selector: selectEnableCharacterInterviews, flag: 'enableCharacterInterviews' as const },
    { selector: selectEnableRtlLayout, flag: 'enableRtlLayout' as const },
    { selector: selectEnableLoraAdapters, flag: 'enableLoraAdapters' as const },
    { selector: selectEnablePluginSystem, flag: 'enablePluginSystem' as const },
    { selector: selectEnableVoiceSupport, flag: 'enableVoiceSupport' as const },
    { selector: selectEnableProForge, flag: 'enableProForge' as const },
    { selector: selectEnableIdbAtRestEncryption, flag: 'enableIdbAtRestEncryption' as const },
    { selector: selectEnableVoiceWasm, flag: 'enableVoiceWasm' as const },
  ])('$flag selector returns correct value when true', ({ selector, flag }) => {
    const s = stateWith({ [flag]: true });
    expect(selector(s)).toBe(true);
  });

  it.each([
    { selector: selectEnableStoryBibleAdvanced, flag: 'enableStoryBibleAdvanced' as const },
    { selector: selectEnableBinderResearch, flag: 'enableBinderResearch' as const },
    { selector: selectEnableCompileWizard, flag: 'enableCompileWizard' as const },
    { selector: selectEnableProjectHealthScore, flag: 'enableProjectHealthScore' as const },
    { selector: selectEnableAppHealthPanel, flag: 'enableAppHealthPanel' as const },
    { selector: selectEnableDuckDbAnalytics, flag: 'enableDuckDbAnalytics' as const },
    { selector: selectEnableObjectsGroups, flag: 'enableObjectsGroups' as const },
    { selector: selectEnableMindMaps, flag: 'enableMindMaps' as const },
    { selector: selectEnableCharacterInterviews, flag: 'enableCharacterInterviews' as const },
    { selector: selectEnableRtlLayout, flag: 'enableRtlLayout' as const },
    { selector: selectEnableLoraAdapters, flag: 'enableLoraAdapters' as const },
    { selector: selectEnablePluginSystem, flag: 'enablePluginSystem' as const },
    { selector: selectEnableVoiceSupport, flag: 'enableVoiceSupport' as const },
    { selector: selectEnableProForge, flag: 'enableProForge' as const },
    { selector: selectEnableIdbAtRestEncryption, flag: 'enableIdbAtRestEncryption' as const },
    { selector: selectEnableVoiceWasm, flag: 'enableVoiceWasm' as const },
  ])('$flag selector returns correct value when false', ({ selector, flag }) => {
    const s = stateWith({ [flag]: false });
    expect(selector(s)).toBe(false);
  });
});
