import { useSyncExternalStore } from 'react';
import { type AiUsageSnapshot, aiUsageTracker } from '../services/ai/aiUsageTracker';

// QNBS-v3: PR4 — subscribe to the latest AI token usage for transparent display in the UI.
export function useAiUsage(): AiUsageSnapshot | null {
  return useSyncExternalStore(
    aiUsageTracker.subscribe,
    aiUsageTracker.getLast,
    aiUsageTracker.getLast,
  );
}
