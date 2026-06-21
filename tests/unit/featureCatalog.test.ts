import { describe, expect, it } from 'vitest';
import {
  FEATURE_CATALOG,
  FEATURE_TIER_ORDER,
  getCatalogEntry,
  getEntriesByTier,
} from '../../features/featureCatalog';
import {
  defaultFeatureFlagsState,
  type FeatureFlagsState,
} from '../../features/featureFlags/featureFlagsSlice';

const ALL_FLAG_KEYS = Object.keys(defaultFeatureFlagsState) as Array<keyof FeatureFlagsState>;

describe('featureCatalog', () => {
  it('covers every flag in the slice exactly once (no missing, no extra, no duplicates)', () => {
    const catalogKeys = FEATURE_CATALOG.map((e) => e.flagKey).sort();
    const sliceKeys = [...ALL_FLAG_KEYS].sort();
    expect(catalogKeys).toEqual(sliceKeys);
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
  });

  // QNBS-v3: THE regression guard — defaultOn is derived from the slice, so this can never drift
  // again (the v1.24 bug was catalog defaultOn:false while the slice said true for ~12 flags).
  it('derives each entry defaultOn from defaultFeatureFlagsState', () => {
    for (const entry of FEATURE_CATALOG) {
      expect(entry.defaultOn).toBe(defaultFeatureFlagsState[entry.flagKey]);
    }
  });

  it('places every entry in a known, ordered tier', () => {
    for (const entry of FEATURE_CATALOG) {
      expect(FEATURE_TIER_ORDER).toContain(entry.tier);
    }
  });

  it('declares only valid flag keys as dependencies', () => {
    for (const entry of FEATURE_CATALOG) {
      for (const dep of entry.requires ?? []) {
        expect(ALL_FLAG_KEYS).toContain(dep);
      }
    }
  });

  it('assigns every entry a risk level', () => {
    for (const entry of FEATURE_CATALOG) {
      expect(['low', 'medium', 'high']).toContain(entry.riskLevel);
    }
  });

  it('getCatalogEntry returns the entry by key, getEntriesByTier partitions the catalog', () => {
    expect(getCatalogEntry('enableProForge')?.tier).toBe('pipeline');
    const total = FEATURE_TIER_ORDER.reduce((n, tier) => n + getEntriesByTier(tier).length, 0);
    expect(total).toBe(FEATURE_CATALOG.length);
  });

  it('marks Rust Compute as desktop-only and Voice WASM as requiring voice support', () => {
    expect(getCatalogEntry('enableRustCompute')?.requiresDesktop).toBe(true);
    expect(getCatalogEntry('enableVoiceWasm')?.requires).toContain('enableVoiceSupport');
  });
});
