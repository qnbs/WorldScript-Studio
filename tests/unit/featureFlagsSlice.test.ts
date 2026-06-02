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
// Shared initial state — must include ALL 20 flags (strict TypeScript)
// ---------------------------------------------------------------------------

const initialState: FeatureFlagsState = {
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  enableAppHealthPanel: false,
  enableDuckDbAnalytics: false,
  enableObjectsGroups: false,
  enableMindMaps: false,
  enableCharacterInterviews: false,
  enableRtlLayout: false,
  enableLoraAdapters: false,
  enablePluginSystem: false,
  enableVoiceSupport: false,
  enableProForge: false,
  enableIdbAtRestEncryption: false,
  enableVoiceWasm: false,
  enableAdaptiveAiEngine: false,
  enableWebnnInference: false,
  enableComputeShaders: false,
  enableWorkerBusV2: false,
  enableRustCompute: false,
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
      defaultOn: false,
    },
    {
      flag: 'enableBinderResearch',
      action: featureFlagsActions.setEnableBinderResearch,
      defaultOn: false,
    },
    {
      flag: 'enableCompileWizard',
      action: featureFlagsActions.setEnableCompileWizard,
      defaultOn: false,
    },
    {
      flag: 'enableProjectHealthScore',
      action: featureFlagsActions.setEnableProjectHealthScore,
      defaultOn: false,
    },
    {
      flag: 'enableAppHealthPanel',
      action: featureFlagsActions.setEnableAppHealthPanel,
      defaultOn: false,
    },
    {
      flag: 'enableDuckDbAnalytics',
      action: featureFlagsActions.setEnableDuckDbAnalytics,
      defaultOn: false,
    },
    {
      flag: 'enableObjectsGroups',
      action: featureFlagsActions.setEnableObjectsGroups,
      defaultOn: false,
    },
    {
      flag: 'enableMindMaps',
      action: featureFlagsActions.setEnableMindMaps,
      defaultOn: false,
    },
    {
      flag: 'enableCharacterInterviews',
      action: featureFlagsActions.setEnableCharacterInterviews,
      defaultOn: false,
    },
    {
      flag: 'enableRtlLayout',
      action: featureFlagsActions.setEnableRtlLayout,
      defaultOn: false,
    },
    {
      flag: 'enableLoraAdapters',
      action: featureFlagsActions.setEnableLoraAdapters,
      defaultOn: false,
    },
    {
      flag: 'enablePluginSystem',
      action: featureFlagsActions.setEnablePluginSystem,
      defaultOn: false,
    },
    {
      flag: 'enableVoiceSupport',
      action: featureFlagsActions.setEnableVoiceSupport,
      defaultOn: false,
    },
    {
      flag: 'enableProForge',
      action: featureFlagsActions.setEnableProForge,
      defaultOn: false,
    },
    {
      flag: 'enableIdbAtRestEncryption',
      action: featureFlagsActions.setEnableIdbAtRestEncryption,
      defaultOn: false,
    },
    {
      flag: 'enableVoiceWasm',
      action: featureFlagsActions.setEnableVoiceWasm,
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
