import type { AIRequestOptions } from '../contracts/providerRequest';

export function withMergedAbortSignal(
  opts: AIRequestOptions,
  signal?: AbortSignal,
  additionalSignal?: AbortSignal,
): AIRequestOptions {
  const signals = [opts.signal, signal, additionalSignal].filter(
    (candidate): candidate is AbortSignal => candidate !== undefined,
  );
  if (signals.length === 0) return opts;
  // QNBS-v3: caller cancellation and service-level duplicate cancellation must both reach the provider.
  const mergedSignal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
  return opts.signal === mergedSignal ? opts : { ...opts, signal: mergedSignal };
}

// QNBS-v3: True for a user/abort-signal cancellation, regardless of how the provider surfaced it.
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

// QNBS-v3: duplicate and caller cancellation must leave the provider loop before fallback can restart work.
export function throwIfRequestAborted(
  error: unknown,
  ...signals: Array<AbortSignal | undefined>
): void {
  const signalAborted = signals.some((candidate) => candidate?.aborted);
  if (!isAbortError(error) && !signalAborted) return;
  throw new DOMException('Aborted', 'AbortError');
}
