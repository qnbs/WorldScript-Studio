// QNBS-v3: AbortSignal-based cancellation token with synchronous state query.

export interface CancellationToken {
  readonly signal: AbortSignal;
  readonly cancel: (reason?: string) => void;
  readonly isCancelled: boolean;
  readonly reason: string | undefined;
}

/**
 * Creates a CancellationToken backed by an AbortController.
 * QNBS-v3: Used throughout WorkerBus v2 to propagate cancellation from UI → queue → worker.
 */
export function createCancellationToken(): CancellationToken {
  const controller = new AbortController();
  let _reason: string | undefined;

  return {
    get signal() {
      return controller.signal;
    },
    get isCancelled() {
      return controller.signal.aborted;
    },
    get reason() {
      return _reason;
    },
    cancel(reason?: string) {
      if (!controller.signal.aborted) {
        _reason = reason;
        controller.abort(reason);
      }
    },
  };
}
