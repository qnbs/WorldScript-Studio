import { describe, expect, it } from 'vitest';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';
import featureFlagsReducer, {
  featureFlagsActions,
} from '../../features/featureFlags/featureFlagsSlice';

describe('featureFlagsSlice', () => {
  const initialState: FeatureFlagsState = {
    enableOllama: false,
    enablePerformanceBudgets: false,
    enableVisualRegression: false,
  };

  it('should have default false feature flags', () => {
    const state = featureFlagsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  it('should toggle feature flags individually', () => {
    let state = featureFlagsReducer(undefined, featureFlagsActions.setEnableOllama(true));
    expect(state.enableOllama).toBe(true);

    state = featureFlagsReducer(state, featureFlagsActions.setEnablePerformanceBudgets(true));
    expect(state.enablePerformanceBudgets).toBe(true);

    state = featureFlagsReducer(state, featureFlagsActions.setEnableVisualRegression(true));
    expect(state.enableVisualRegression).toBe(true);
  });

  it('setFeatureFlags replaces entire state', () => {
    const next: FeatureFlagsState = {
      enableOllama: true,
      enablePerformanceBudgets: true,
      enableVisualRegression: false,
    };
    const state = featureFlagsReducer(undefined, featureFlagsActions.setFeatureFlags(next));
    expect(state).toEqual(next);
  });

  it('disabling a flag sets it back to false', () => {
    let state = featureFlagsReducer(undefined, featureFlagsActions.setEnableOllama(true));
    state = featureFlagsReducer(state, featureFlagsActions.setEnableOllama(false));
    expect(state.enableOllama).toBe(false);
  });
});
