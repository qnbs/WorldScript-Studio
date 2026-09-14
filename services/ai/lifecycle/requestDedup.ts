import type { AIProvider, AiModel } from '../../../types';
import type { AIRequestOptions } from '../contracts/providerRequest';
import { resolvePositiveRoutingOpts } from '../positiveRouting';
import { throwIfRequestAborted, withMergedAbortSignal } from './cancellation';

const pendingRequests = new Map<string, AbortController>();

function pendingKey(provider: AIProvider, model: AiModel, prompt: string, scope?: string): string {
  return JSON.stringify([scope ?? 'global', provider, model, prompt.slice(0, 128)]);
}

/** @internal Only for test isolation — clears in-flight dedup state between tests. */
export function clearPendingRequestsForTest(): void {
  pendingRequests.clear();
}

function deduplicateRequest(
  opts: Pick<AIRequestOptions, 'provider' | 'model' | 'deduplicationScope'>,
  prompt: string,
): { key: string; controller: AbortController } {
  const key = pendingKey(opts.provider, opts.model, prompt, opts.deduplicationScope);
  const existing = pendingRequests.get(key);
  if (existing) {
    existing.abort();
    pendingRequests.delete(key);
  }
  const controller = new AbortController();
  pendingRequests.set(key, controller);
  return { key, controller };
}

function cleanupPendingRequest(key: string, controller: AbortController): void {
  if (pendingRequests.get(key) === controller) pendingRequests.delete(key);
}

// QNBS-v3: keep caller and service deduplication cancellation under one lifecycle owner.
export async function withDeduplicatedRequest<T>(
  opts: AIRequestOptions,
  prompt: string,
  signal: AbortSignal | undefined,
  operation: (mergedOpts: AIRequestOptions) => Promise<T>,
): Promise<T> {
  const resolvedOpts = resolvePositiveRoutingOpts(opts);
  throwIfRequestAborted(undefined, resolvedOpts.signal, signal);
  const { key, controller } = deduplicateRequest(resolvedOpts, prompt);
  try {
    return await operation(withMergedAbortSignal(resolvedOpts, signal, controller.signal));
  } finally {
    cleanupPendingRequest(key, controller);
  }
}
