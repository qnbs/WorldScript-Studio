/**
 * Shared LRU cache for loaded inference pipelines (transformers.js / ONNX).
 * QNBS-v3: Phase 2.3 — extracted from the byte-identical LRU loops that were duplicated in
 *          `workers/inference.worker.ts` and `workers/v2/inference.worker.ts`. Two real fixes
 *          over the inlined version:
 *            1. **dispose-on-evict** — evicted pipelines now `dispose()`, closing the VRAM/RAM
 *               leak (same bug-class as the WebLLM eviction fix in AUDIT 2026-06-01 #1).
 *            2. **in-flight dedup** — concurrent loads of the same key share one promise, so the
 *               same multi-MB model is never fetched/compiled twice in parallel.
 *          Pure + env-agnostic (no DOM/worker globals); `now` is injectable for deterministic tests.
 */

/** Default cap — keeps loaded-model count bounded to avoid VRAM/RAM pressure. */
export const MAX_PIPELINE_CACHE = 8;

export interface PipelineLruOptions<T> {
  /** Max resident entries before LRU eviction. Default {@link MAX_PIPELINE_CACHE}. */
  maxSize?: number;
  /** Injectable clock for LRU recency. Default `Date.now`. */
  now?: () => number;
  /**
   * Called with each evicted/replaced/cleared value so backends can release GPU/WASM memory.
   * May be sync or async; the cache swallows sync throws and async rejections (best-effort),
   * so callers never need to wrap it in a catch.
   */
  dispose?: (value: T) => void | Promise<void>;
}

interface Entry<T> {
  value: T;
  lastUsedAt: number;
}

export class PipelineLruCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly maxSize: number;
  private readonly now: () => number;
  private readonly disposeFn: ((value: T) => void | Promise<void>) | undefined;

  constructor(opts?: PipelineLruOptions<T>) {
    this.maxSize = Math.max(1, opts?.maxSize ?? MAX_PIPELINE_CACHE);
    this.now = opts?.now ?? Date.now;
    this.disposeFn = opts?.dispose;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Read a cached value, marking it most-recently-used. Returns undefined on miss. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.lastUsedAt = this.now();
    return entry.value;
  }

  /** Insert/replace a value, evicting the LRU entry first if at capacity. */
  set(key: string, value: T): void {
    const existing = this.entries.get(key);
    if (existing) {
      // QNBS-v3: replacing a live key must release the previous value or it leaks (CodeAnt PR #69).
      if (existing.value !== value) this.safeDispose(existing.value);
    } else {
      this.evictIfNeeded();
    }
    this.entries.set(key, { value, lastUsedAt: this.now() });
  }

  /**
   * Return a cached value or load it via `loader`. Concurrent calls for the same key share a
   * single in-flight promise (no double-load). A rejected load never poisons the cache.
   */
  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        this.pending.delete(key);
        return value;
      })
      .catch((err: unknown) => {
        this.pending.delete(key);
        throw err;
      });
    this.pending.set(key, promise);
    return promise;
  }

  /** Drop every entry, disposing each value. In-flight loads are left to settle on their own. */
  clear(): void {
    for (const entry of this.entries.values()) this.safeDispose(entry.value);
    this.entries.clear();
  }

  /** Evict least-recently-used entries until there is room for one more. */
  private evictIfNeeded(): void {
    while (this.entries.size >= this.maxSize) {
      let oldestKey: string | undefined;
      let oldestTs = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (entry.lastUsedAt < oldestTs) {
          oldestTs = entry.lastUsedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) break;
      const evicted = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (evicted) this.safeDispose(evicted.value);
    }
  }

  /**
   * Invoke the dispose callback defensively: swallow synchronous throws and async rejections so a
   * failing backend disposal can never surface as an unhandled rejection in worker/main contexts
   * (CodeAnt PR #69). Centralising it here keeps caller-supplied `dispose` callbacks trivial.
   */
  private safeDispose(value: T): void {
    const fn = this.disposeFn;
    if (!fn) return;
    try {
      const result = fn(value) as unknown;
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        (result as Promise<unknown>).then(undefined, () => {
          /* best-effort disposal — ignore async failure */
        });
      }
    } catch {
      /* best-effort disposal — ignore synchronous failure */
    }
  }
}
