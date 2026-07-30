import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: duckdbClient now routes through WorkerBus v2 (workers/v2/duckdb.worker.ts) instead of
//          spawning a raw Worker directly — mock services/workerBusManager's ensureDuckDbPool()/
//          getWorkerBus() instead of the global Worker constructor.

const { mockEnqueue, mockTerminatePool, mockEnsureDuckDbPool, mockGetWorkerBus } = vi.hoisted(
  () => ({
    mockEnqueue: vi.fn(),
    mockTerminatePool: vi.fn(),
    mockEnsureDuckDbPool: vi.fn(),
    mockGetWorkerBus: vi.fn(),
  }),
);

vi.mock('../../services/workerBusManager', () => ({
  ensureDuckDbPool: mockEnsureDuckDbPool,
  getWorkerBus: mockGetWorkerBus,
}));

const { duckdbClient } = await import('../../services/duckdb/duckdbClient');

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeHandle(result: Promise<unknown>, cancel: ReturnType<typeof vi.fn> = vi.fn()) {
  return { taskId: 't1', result, progress: (async function* () {})(), cancel };
}

function makeBus() {
  return { enqueue: mockEnqueue, terminatePool: mockTerminatePool };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureDuckDbPool.mockResolvedValue(makeBus());
  mockGetWorkerBus.mockReturnValue(makeBus());
});

describe('duckdbClient.init', () => {
  it('enqueues db.duckdb.init with the db.duckdb capability and returns {ok:true}', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.resolve({ ok: true })));

    const res = await duckdbClient.init();

    expect(mockEnqueue).toHaveBeenCalledWith(
      'db.duckdb.init',
      expect.anything(),
      expect.objectContaining({ capabilities: ['db.duckdb'] }),
    );
    expect(res.ok).toBe(true);
  });

  it('returns {ok:false} without enqueuing when the pool is unavailable', async () => {
    mockEnsureDuckDbPool.mockResolvedValue(null);

    const res = await duckdbClient.init();

    expect(res).toEqual(expect.objectContaining({ ok: false, error: 'WorkerBus v2 unavailable' }));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('duckdbClient.query', () => {
  it('enqueues db.duckdb.query and wraps the raw row array as {ok:true, rows}', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.resolve([{ n: 1 }])));

    const res = await duckdbClient.query('SELECT 1 AS n');

    const [taskType, payload] = mockEnqueue.mock.calls[0] as [string, unknown];
    expect(taskType).toBe('db.duckdb.query');
    expect(payload).toEqual({ sql: 'SELECT 1 AS n', params: undefined });
    expect(res).toEqual(expect.objectContaining({ ok: true, rows: [{ n: 1 }] }));
  });

  it('returns {ok:false, error} (not a thrown exception) when the task rejects', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.reject(new Error('bad sql'))));

    const res = await duckdbClient.query('garbage');

    expect(res).toEqual(expect.objectContaining({ ok: false, error: 'bad sql' }));
  });

  it('maps a CIRCUIT_OPEN error code to a friendly message', async () => {
    const err = Object.assign(new Error('circuit open'), { code: 'CIRCUIT_OPEN' });
    mockEnqueue.mockReturnValue(makeHandle(Promise.reject(err)));

    const res = await duckdbClient.query('SELECT 1');

    expect(res).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'DuckDB temporarily unavailable (circuit open)',
      }),
    );
  });

  it('stringifies a rejection that is not an Error instance', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.reject('plain string rejection')));

    const res = await duckdbClient.query('SELECT 1');

    expect(res).toEqual(expect.objectContaining({ ok: false, error: 'plain string rejection' }));
  });

  it('disables WorkerBus-level retries (retryPolicy maxRetries:0) to avoid stacking under withDuckDbRetry', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.resolve([])));

    await duckdbClient.query('SELECT 1');

    expect(mockEnqueue).toHaveBeenCalledWith(
      'db.duckdb.query',
      expect.anything(),
      expect.objectContaining({ retryPolicy: { maxRetries: 0 } }),
    );
  });

  describe('auto-reinit on "DuckDB not initialized"', () => {
    // QNBS-v3: [Regression coverage for the idle-respawn/crash-restart gap — a fresh duckdb pool
    //          worker has no `connection` until INIT runs again on it.]
    it('re-inits once and retries the original query, then succeeds', async () => {
      let queryCallCount = 0;
      mockEnqueue.mockImplementation((taskType: string) => {
        if (taskType === 'db.duckdb.query') {
          queryCallCount++;
          if (queryCallCount === 1) {
            return makeHandle(Promise.reject(new Error('DuckDB not initialized')));
          }
          return makeHandle(Promise.resolve([{ n: 1 }]));
        }
        if (taskType === 'db.duckdb.init') {
          return makeHandle(Promise.resolve({ ok: true }));
        }
        throw new Error(`unexpected taskType ${taskType}`);
      });

      const res = await duckdbClient.query('SELECT 1 AS n');

      expect(res).toEqual(expect.objectContaining({ ok: true, rows: [{ n: 1 }] }));
      expect(queryCallCount).toBe(2);
      const initCalls = mockEnqueue.mock.calls.filter(([t]) => t === 'db.duckdb.init');
      expect(initCalls).toHaveLength(1);
    });

    it('attempts exactly one reinit — does not loop when the retry also fails', async () => {
      mockEnqueue.mockImplementation((taskType: string) => {
        if (taskType === 'db.duckdb.query') {
          return makeHandle(Promise.reject(new Error('DuckDB not initialized')));
        }
        if (taskType === 'db.duckdb.init') {
          return makeHandle(Promise.resolve({ ok: true }));
        }
        throw new Error(`unexpected taskType ${taskType}`);
      });

      const res = await duckdbClient.query('SELECT 1');

      expect(res).toEqual(expect.objectContaining({ ok: false, error: 'DuckDB not initialized' }));
      const initCalls = mockEnqueue.mock.calls.filter(([t]) => t === 'db.duckdb.init');
      expect(initCalls).toHaveLength(1);
    });

    it('does not retry the original query when the reinit INIT task itself rejects', async () => {
      // QNBS-v3: [reinit.ok is only false when send('INIT', ...) itself hits the catch branch —
      //          i.e. the INIT task's handle.result *rejects*. Distinct from the 'INIT enqueue
      //          resolves but with an app-level failure shape' case, which send() doesn't model:
      //          any resolved handle.result is always treated as {ok:true}.]
      mockEnqueue.mockImplementation((taskType: string) => {
        if (taskType === 'db.duckdb.query') {
          return makeHandle(Promise.reject(new Error('DuckDB not initialized')));
        }
        if (taskType === 'db.duckdb.init') {
          return makeHandle(Promise.reject(new Error('worker spawn failed')));
        }
        throw new Error(`unexpected taskType ${taskType}`);
      });

      const res = await duckdbClient.query('SELECT 1');

      expect(res).toEqual(expect.objectContaining({ ok: false, error: 'DuckDB not initialized' }));
      const queryCalls = mockEnqueue.mock.calls.filter(([t]) => t === 'db.duckdb.query');
      expect(queryCalls).toHaveLength(1);
    });

    it('does not reinit-retry unrelated error messages', async () => {
      mockEnqueue.mockReturnValue(makeHandle(Promise.reject(new Error('syntax error'))));

      const res = await duckdbClient.query('garbage');

      expect(res).toEqual(expect.objectContaining({ ok: false, error: 'syntax error' }));
      const initCalls = mockEnqueue.mock.calls.filter(([t]) => t === 'db.duckdb.init');
      expect(initCalls).toHaveLength(0);
    });

    it('does not recursively reinit when INIT itself fails with "DuckDB not initialized"', async () => {
      mockEnqueue.mockReturnValue(makeHandle(Promise.reject(new Error('DuckDB not initialized'))));

      await duckdbClient.init();

      const initCalls = mockEnqueue.mock.calls.filter(([t]) => t === 'db.duckdb.init');
      expect(initCalls).toHaveLength(1);
    });
  });
});

describe('duckdbClient.exec', () => {
  it('enqueues db.duckdb.exec and returns {ok:true}', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.resolve({ ok: true })));

    const res = await duckdbClient.exec('CREATE TABLE t (id INTEGER)');

    expect((mockEnqueue.mock.calls[0] as [string])[0]).toBe('db.duckdb.exec');
    expect(res.ok).toBe(true);
  });
});

describe('duckdbClient.shutdown', () => {
  it('enqueues db.duckdb.shutdown', async () => {
    mockEnqueue.mockReturnValue(makeHandle(Promise.resolve({ ok: true })));

    const res = await duckdbClient.shutdown();

    expect((mockEnqueue.mock.calls[0] as [string])[0]).toBe('db.duckdb.shutdown');
    expect(res.ok).toBe(true);
  });
});

describe('duckdbClient.terminate', () => {
  it('terminates only the "duckdb" pool, not the whole shared bus', () => {
    duckdbClient.terminate();

    expect(mockTerminatePool).toHaveBeenCalledWith('duckdb');
  });

  it('is a no-op when the bus was never initialized', () => {
    mockGetWorkerBus.mockReturnValue(null);

    expect(() => duckdbClient.terminate()).not.toThrow();
    expect(mockTerminatePool).not.toHaveBeenCalled();
  });
});

describe('duckdbClient abort', () => {
  it('cancels the task handle when the AbortSignal fires mid-flight', async () => {
    const cancel = vi.fn();
    const { promise: resultPromise, reject } = deferred<unknown>();
    mockEnqueue.mockReturnValue(makeHandle(resultPromise, cancel));

    const controller = new AbortController();
    const resPromise = duckdbClient.query('SELECT 1', undefined, controller.signal);
    controller.abort();

    // QNBS-v3: cancel() fires after the async ensureDuckDbPool()/enqueue() chain settles, not
    //          synchronously — unlike v1's Promise-executor version. waitFor tolerates that gap
    //          without hardcoding a specific number of microtask ticks.
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('Aborted'));

    reject(Object.assign(new Error('Task was cancelled'), { code: 'CANCELLED' }));
    const res = await resPromise;

    expect(res).toEqual(expect.objectContaining({ ok: false, error: 'Aborted' }));
  });

  it('registers the abort listener synchronously, so an already-fired-before-enqueue abort is not lost', async () => {
    const cancel = vi.fn();
    const { promise: resultPromise } = deferred<unknown>();
    mockEnqueue.mockReturnValue(makeHandle(resultPromise, cancel));

    const controller = new AbortController();
    controller.abort();
    void duckdbClient.query('SELECT 1', undefined, controller.signal);

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('Aborted'));
  });

  it('does not miss an abort fired in the same tick as the call, before ensureDuckDbPool resolves', async () => {
    const cancel = vi.fn();
    const { promise: resultPromise } = deferred<unknown>();
    mockEnqueue.mockReturnValue(makeHandle(resultPromise, cancel));
    // QNBS-v3: regression guard for the real timing bug this PR fixed — the abort listener must
    //          be attached before the `await ensureDuckDbPool()` inside send() yields, so an
    //          abort fired synchronously right after the call (same tick, no microtask flush
    //          in between) still gets caught once the handle exists.
    let resolveEnsurePool!: (bus: ReturnType<typeof makeBus>) => void;
    mockEnsureDuckDbPool.mockReturnValue(
      new Promise((res) => {
        resolveEnsurePool = res;
      }),
    );

    const controller = new AbortController();
    void duckdbClient.query('SELECT 1', undefined, controller.signal);
    controller.abort();
    resolveEnsurePool(makeBus());

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('Aborted'));
  });

  it('detaches its abort listener once the call settles, so a reused signal does not accumulate listeners', async () => {
    // QNBS-v3: [regression guard — {once:true} only self-removes when the signal actually
    //          fires; a caller reusing one AbortSignal across many non-aborted queries must not
    //          leak one listener per call for the signal's whole lifetime.]
    mockEnqueue.mockReturnValue(makeHandle(Promise.resolve([{ n: 1 }])));
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    await duckdbClient.query('SELECT 1', undefined, controller.signal);

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('duckdbClient OPFS fallback', () => {
  // QNBS-v3: afterEach (not end-of-test) so the handler resets even if an assertion throws first
  afterEach(() => {
    duckdbClient.setOpfsFallbackHandler(null);
  });

  it('forwards the opfs-fallback progress stage to setOpfsFallbackHandler', async () => {
    let capturedOnProgress: ((p: { stage: string; message?: string }) => void) | undefined;
    mockEnqueue.mockImplementation((_type, _payload, opts) => {
      capturedOnProgress = opts.onProgress;
      return makeHandle(Promise.resolve({ ok: true }));
    });
    const onFallback = vi.fn();
    duckdbClient.setOpfsFallbackHandler(onFallback);

    await duckdbClient.init();
    capturedOnProgress?.({ stage: 'opfs-fallback', message: 'OPFS unavailable in private mode' });

    expect(onFallback).toHaveBeenCalledWith('OPFS unavailable in private mode');
  });

  it('defaults to a generic message when the opfs-fallback progress event omits one', async () => {
    let capturedOnProgress: ((p: { stage: string; message?: string }) => void) | undefined;
    mockEnqueue.mockImplementation((_type, _payload, opts) => {
      capturedOnProgress = opts.onProgress;
      return makeHandle(Promise.resolve({ ok: true }));
    });
    const onFallback = vi.fn();
    duckdbClient.setOpfsFallbackHandler(onFallback);

    await duckdbClient.init();
    capturedOnProgress?.({ stage: 'opfs-fallback' });

    expect(onFallback).toHaveBeenCalledWith('OPFS unavailable');
  });

  it('ignores non-opfs-fallback progress stages', async () => {
    let capturedOnProgress: ((p: { stage: string; message?: string }) => void) | undefined;
    mockEnqueue.mockImplementation((_type, _payload, opts) => {
      capturedOnProgress = opts.onProgress;
      return makeHandle(Promise.resolve({ ok: true }));
    });
    const onFallback = vi.fn();
    duckdbClient.setOpfsFallbackHandler(onFallback);

    await duckdbClient.init();
    capturedOnProgress?.({ stage: 'loading', message: 'irrelevant' });

    expect(onFallback).not.toHaveBeenCalled();
  });
});
