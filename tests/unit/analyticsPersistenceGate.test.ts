import { describe, expect, it } from 'vitest';

import { isAnalyticsPersistenceAllowed } from '../../app/listenerMiddleware';
import type { RootState } from '../../app/store';

// QNBS-v3: SEC — the gate that makes the Settings → Privacy "Analytics" toggle actually stop DuckDB
// writes + inference telemetry. Before this gate the toggle was cosmetic (only the feature flag
// controlled persistence). Both inputs must be true for any analytics data to be persisted.

function makeState(opts: { flag: boolean; analyticsEnabled: boolean }): RootState {
  return {
    featureFlags: { enableDuckDbAnalytics: opts.flag },
    settings: { privacy: { analyticsEnabled: opts.analyticsEnabled } },
  } as unknown as RootState;
}

describe('isAnalyticsPersistenceAllowed', () => {
  it('allows persistence only when the flag AND the privacy opt-out are both on', () => {
    expect(isAnalyticsPersistenceAllowed(makeState({ flag: true, analyticsEnabled: true }))).toBe(
      true,
    );
  });

  it('blocks persistence when the privacy opt-out is off, even with the flag on', () => {
    expect(isAnalyticsPersistenceAllowed(makeState({ flag: true, analyticsEnabled: false }))).toBe(
      false,
    );
  });

  it('blocks persistence when the feature flag is off, even with analytics enabled', () => {
    expect(isAnalyticsPersistenceAllowed(makeState({ flag: false, analyticsEnabled: true }))).toBe(
      false,
    );
  });

  it('blocks persistence when both are off', () => {
    expect(isAnalyticsPersistenceAllowed(makeState({ flag: false, analyticsEnabled: false }))).toBe(
      false,
    );
  });

  it('treats a missing featureFlags slice as not allowed (no crash)', () => {
    const state = {
      settings: { privacy: { analyticsEnabled: true } },
    } as unknown as RootState;
    expect(isAnalyticsPersistenceAllowed(state)).toBe(false);
  });
});
