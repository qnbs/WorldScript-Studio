import { describe, it, expect } from 'vitest';
import featureFlagsReducer, {
  featureFlagsActions,
} from '../../features/featureFlags/featureFlagsSlice';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';

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
});
