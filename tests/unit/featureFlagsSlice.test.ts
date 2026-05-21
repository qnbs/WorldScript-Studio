import { describe, expect, it } from 'vitest';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';
import featureFlagsReducer, {
  featureFlagsActions,
} from '../../features/featureFlags/featureFlagsSlice';

describe('featureFlagsSlice', () => {
  const initialState: FeatureFlagsState = {
    enableCodexAutoTracking: true,
    enableStoryBibleAdvanced: false,
    enableBinderResearch: false,
    enableCompileWizard: false,
    enableProjectHealthScore: false,
    enableCrossProjectSearch: true,
    enableAppHealthPanel: false,
    enablePlotBoardV2: true,
    enableDuckDbAnalytics: false,
    enableObjectsGroups: false,
    enableMindMaps: false,
    enableCharacterInterviews: false,
  };

  it('should match default feature flag state on init', () => {
    const state = featureFlagsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  it('should toggle individual feature flags', () => {
    const state = featureFlagsReducer(
      undefined,
      featureFlagsActions.setEnableCodexAutoTracking(false),
    );
    expect(state.enableCodexAutoTracking).toBe(false);
  });

  it('setFeatureFlags replaces entire state', () => {
    const next: FeatureFlagsState = {
      enableCodexAutoTracking: false,
      enableStoryBibleAdvanced: true,
      enableBinderResearch: false,
      enableCompileWizard: true,
      enableProjectHealthScore: false,
      enableCrossProjectSearch: true,
      enableAppHealthPanel: false,
      enablePlotBoardV2: true,
      enableDuckDbAnalytics: false,
      enableObjectsGroups: false,
      enableMindMaps: false,
      enableCharacterInterviews: false,
    };
    const state = featureFlagsReducer(undefined, featureFlagsActions.setFeatureFlags(next));
    expect(state).toEqual(next);
  });

  it('disabling a flag sets it back to false', () => {
    let state = featureFlagsReducer(
      undefined,
      featureFlagsActions.setEnableCodexAutoTracking(false),
    );
    state = featureFlagsReducer(state, featureFlagsActions.setEnableCodexAutoTracking(true));
    expect(state.enableCodexAutoTracking).toBe(true);
  });
});
