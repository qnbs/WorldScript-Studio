import { useCallback, useSyncExternalStore } from 'react';
import { type AiUsageSnapshot, aiUsageTracker } from '../services/ai/aiUsageTracker';

// QNBS-v3: PR4 — subscribe to the latest AI token usage for transparent display in the UI. Pass a
// `source` (e.g. 'writer') to scope to that surface so a badge never shows another surface's usage.
export function useAiUsage(source?: string): AiUsageSnapshot | null {
  const getSnapshot = useCallback(() => aiUsageTracker.getLast(source), [source]);
  return useSyncExternalStore(aiUsageTracker.subscribe, getSnapshot, getSnapshot);
}
