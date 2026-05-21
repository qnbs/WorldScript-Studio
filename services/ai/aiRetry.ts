/** Transient AI call retries with linear backoff (per provider attempt). */
export const DEFAULT_AI_RETRY_ATTEMPTS = 2;
export const AI_RETRY_BASE_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? DEFAULT_AI_RETRY_ATTEMPTS;
  const baseDelayMs = opts?.baseDelayMs ?? AI_RETRY_BASE_DELAY_MS;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await delay(baseDelayMs * (i + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
