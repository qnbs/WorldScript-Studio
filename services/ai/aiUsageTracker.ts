// services/ai/aiUsageTracker.ts
//
// QNBS-v3: PR4 — AI transparency. A tiny observable singleton that records the token usage of the
// most recent AI request *per surface* (writer, copilot, …) so the UI can surface the right one
// without coupling the low-level AI fetch to React/Redux. No tokens or payloads are ever logged.

export interface AiUsageSnapshot {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** epoch ms when recorded */
  at: number;
  /** which app surface produced the request (e.g. 'writer') */
  source: string;
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

// QNBS-v3 (CodeAnt): keyed by source so one surface's request can't overwrite another's "last
// request" (the Writer badge must not show a Copilot completion).
const lastBySource = new Map<string, AiUsageSnapshot>();
const listeners = new Set<() => void>();

function normalize(u: RawUsage): {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
} {
  // QNBS-v3 (CodeAnt): use `||` so a zero-valued legacy field falls through to the modern
  // input/output fields (and a zero total is derived from prompt+completion), instead of being
  // taken as a real value and dropping otherwise-valid usage.
  const promptTokens = u.promptTokens || u.inputTokens || 0;
  const completionTokens = u.completionTokens || u.outputTokens || 0;
  const totalTokens = u.totalTokens || promptTokens + completionTokens;
  return { totalTokens, promptTokens, completionTokens };
}

export const aiUsageTracker = {
  /** Record usage for the latest request of a surface. `at` is injectable for deterministic tests. */
  record(usage: RawUsage, source = 'unknown', at: number = Date.now()): void {
    const n = normalize(usage);
    // Ignore empty/zero reports — they would clear a meaningful prior reading for no benefit.
    if (n.totalTokens <= 0) return;
    lastBySource.set(source, { ...n, at, source });
    for (const l of listeners) l();
  },
  /** Latest usage for a given source, or (no source) the most recent across all surfaces. */
  getLast(source?: string): AiUsageSnapshot | null {
    if (source !== undefined) return lastBySource.get(source) ?? null;
    let latest: AiUsageSnapshot | null = null;
    for (const snap of lastBySource.values()) {
      if (!latest || snap.at > latest.at) latest = snap;
    }
    return latest;
  },
  reset(): void {
    lastBySource.clear();
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
