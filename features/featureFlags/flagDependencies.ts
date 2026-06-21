/**
 * QNBS-v3: Pure, Redux-free resolution of feature-flag dependencies.
 *
 * The catalog (`featureCatalog.ts`) declares two kinds of prerequisite:
 *  - `requires: [...]`  — other flags that must be ON for this feature to do anything.
 *  - `requiresDesktop`  — the feature only takes effect inside the Tauri desktop runtime.
 *
 * This helper computes, for a single flag, whether those prerequisites are currently met. It does
 * NOT mutate state — Redux stays the single source of truth. The Settings UI uses it to disable a
 * dependent toggle and explain why; runtime callers may read `effectiveEnabled` for a combined gate.
 */

import { getCatalogEntry } from '../featureCatalog';
import type { FeatureFlagsState } from './featureFlagsSlice';

export interface FlagAvailability {
  /** The flag is ON and every prerequisite (flag + desktop) is satisfied. */
  effectiveEnabled: boolean;
  /** Prerequisite flags that are declared by the catalog but currently OFF. */
  blockedBy: Array<keyof FeatureFlagsState>;
  /** True when the feature is desktop-only and we are NOT in the desktop runtime. */
  blockedByDesktop: boolean;
}

/**
 * Resolve a single flag's availability given the current flag state and whether we are running in
 * the desktop (Tauri) runtime.
 */
export function resolveFlagAvailability(
  flagKey: keyof FeatureFlagsState,
  flags: FeatureFlagsState,
  isDesktop: boolean,
): FlagAvailability {
  const entry = getCatalogEntry(flagKey);
  const blockedBy = (entry?.requires ?? []).filter((dep) => !flags[dep]);
  const blockedByDesktop = entry?.requiresDesktop === true && !isDesktop;
  const prerequisitesMet = blockedBy.length === 0 && !blockedByDesktop;

  return {
    effectiveEnabled: Boolean(flags[flagKey]) && prerequisitesMet,
    blockedBy,
    blockedByDesktop,
  };
}
