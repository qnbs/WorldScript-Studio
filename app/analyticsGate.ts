import type { RootState } from './store';
import { appStoreRef } from './storeRef';

// QNBS-v3: SEC — single source of truth for "may analytics data be persisted to DuckDB / telemetry".
// DuckDB analytics persistence requires BOTH the feature flag (enableDuckDbAnalytics) AND the
// user-facing Settings → Privacy "Analytics" opt-out (settings.privacy.analyticsEnabled). Analytics
// data is local-only metadata (titles/loglines/word-counts/codex excerpts/RAG vectors; never
// manuscript prose, never leaves the device), but a privacy toggle that does nothing is a dark
// pattern. EVERY DuckDB-persisting write path — middleware listeners AND user-triggered UI rebuilds
// (AiSections, ReferencePanelView) — must route its persistence decision through this function so the
// opt-out is enforced uniformly.
export function isAnalyticsPersistenceAllowed(state: RootState): boolean {
  return (
    Boolean(state.featureFlags?.enableDuckDbAnalytics) && state.settings.privacy.analyticsEnabled
  );
}

// QNBS-v3: selector alias for components — `useAppSelector(selectAnalyticsPersistenceAllowed)`.
export const selectAnalyticsPersistenceAllowed = isAnalyticsPersistenceAllowed;

// QNBS-v3: SEC — live, store-backed gate for user-triggered persistence (e.g. manual RAG rebuild from
// AiSections / ReferencePanelView). Pass this function as rebuildHybridRagIndex's duckDbEnabled
// callback so the privacy opt-out is re-evaluated at write time, after the async embedding loop —
// closing the same opt-out race the middleware path guards against. Returns false if the store ref is
// not yet wired (fail-closed).
export function analyticsPersistenceAllowedNow(): boolean {
  const state = appStoreRef.current?.getState();
  return state ? isAnalyticsPersistenceAllowed(state) : false;
}
