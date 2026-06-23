// services/ai/aiUsageTracker.ts
//
// QNBS-v3: PR4 — AI transparency. A tiny observable singleton that records the token usage of the
// most recent AI request so the UI can surface it, without coupling the low-level AI fetch to React
// or Redux. The streaming completion path reports usage here; `useAiUsage` subscribes via
// useSyncExternalStore. No tokens or payloads are ever logged.

export interface AiUsageSnapshot {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** epoch ms when recorded */
  at: number;
}

/** The various token-field shapes emitted across AI SDK versions / providers. */
// QNBS-v3: fields are `?: number | undefined` (not just `?: number`) so an SDK usage object whose
// counts are explicitly `number | undefined` stays assignable under exactOptionalPropertyTypes.
export interface RawUsage {
  totalTokens?: number | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

let last: AiUsageSnapshot | null = null;
const listeners = new Set<() => void>();

function normalize(u: RawUsage): {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
} {
  const promptTokens = u.promptTokens ?? u.inputTokens ?? 0;
  const completionTokens = u.completionTokens ?? u.outputTokens ?? 0;
  const totalTokens = u.totalTokens ?? promptTokens + completionTokens;
  return { totalTokens, promptTokens, completionTokens };
}

export const aiUsageTracker = {
  /** Record usage for the latest request. `at` is injectable for deterministic tests. */
  record(usage: RawUsage, at: number = Date.now()): void {
    const n = normalize(usage);
    // Ignore empty/zero reports — they would clear a meaningful prior reading for no benefit.
    if (n.totalTokens <= 0) return;
    last = { ...n, at };
    for (const l of listeners) l();
  },
  getLast(): AiUsageSnapshot | null {
    return last;
  },
  reset(): void {
    last = null;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
