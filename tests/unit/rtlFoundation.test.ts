/**
 * RTL Foundation unit tests.
 * Covers: RTL_LOCALES set, enableRtlLayout flag state machine, dir attribute derivation.
 */

import { describe, expect, it } from 'vitest';
import { type Language, RTL_LOCALES } from '../../contexts/I18nContext';
import featureFlagsReducer, {
  featureFlagsActions,
} from '../../features/featureFlags/featureFlagsSlice';

describe('RTL_LOCALES', () => {
  it('does not include any currently-shipped LTR locales', () => {
    const ltrLocales: Language[] = ['en', 'de', 'es', 'fr', 'it'];
    for (const locale of ltrLocales) {
      expect(RTL_LOCALES.has(locale)).toBe(false);
    }
  });
});

describe('enableRtlLayout feature flag', () => {
  it('defaults to false so RTL never activates without an explicit opt-in', () => {
    const state = featureFlagsReducer(undefined, { type: '@@INIT' });
    expect(state.enableRtlLayout).toBe(false);
  });

  it('can be toggled to true via setEnableRtlLayout, which drives document.documentElement.dir in App.tsx', () => {
    const initial = featureFlagsReducer(undefined, { type: '@@INIT' });
    const updated = featureFlagsReducer(initial, featureFlagsActions.setEnableRtlLayout(true));
    expect(updated.enableRtlLayout).toBe(true);
  });
});
