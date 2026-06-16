import type { FeatureFlagsState } from './featureFlagsSlice';

const FEATURE_FLAGS_STORAGE_KEY = 'worldscript-feature-flags';
const LEGACY_FEATURE_FLAGS_STORAGE_KEY = 'storycraft-feature-flags';

function getItem(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // localStorage may be blocked or unavailable (quota / private mode).
    return false;
  }
}

function removeItem(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // localStorage may be blocked or unavailable.
  }
}

/** Load the persisted feature flags, migrating any legacy StoryCraft key once. */
export function loadFeatureFlags(): string | null {
  let stored = getItem(FEATURE_FLAGS_STORAGE_KEY);

  // QNBS-v3: Rebrand migration — migrate legacy StoryCraft feature flags once, then drop the old key.
  if (!stored) {
    const legacy = getItem(LEGACY_FEATURE_FLAGS_STORAGE_KEY);
    if (legacy) {
      // QNBS-v3: only drop the legacy key once the new key is confirmed written. setItem can
      // fail silently (quota/private-storage), and an unconditional delete would erase the saved
      // flags. If the write fails we keep the legacy key and still use its value this session.
      if (setItem(FEATURE_FLAGS_STORAGE_KEY, legacy)) {
        removeItem(LEGACY_FEATURE_FLAGS_STORAGE_KEY);
      }
      stored = legacy;
    }
  }

  return stored;
}

/** Persist the current feature flags state. */
export function saveFeatureFlags(state: FeatureFlagsState): void {
  setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(state));
}

/** TEST ONLY: reset the in-memory/storage state used by tests. */
export function _resetFeatureFlagsStorage(): void {
  removeItem(FEATURE_FLAGS_STORAGE_KEY);
  removeItem(LEGACY_FEATURE_FLAGS_STORAGE_KEY);
}
