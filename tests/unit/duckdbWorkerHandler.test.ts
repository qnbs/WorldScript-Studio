// @vitest-environment jsdom
// QNBS-v3: [Parity gate for the v2 DuckDB worker handlers (docs/adr/0014) — catches response-shape/OPFS-fallback drift from v1 before any consumer cuts over.]

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerHandlerContext } from '../../packages/worker-bus/src/workerBootstrap';

class MockWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
}
vi.stubGlobal('Worker', MockWorker);

// QNBS-v3: [vi.hoisted — the mock factory runs during the hoisted import phase, so plain consts would hit a TDZ ReferenceError.]
const {
  mockSelectBundle,
  mockInstantiate,
  mockRegisterFileHandle,
  mockConnect,
  mockDbTerminate,
  MockAsyncDuckDB,
} = vi.hoisted(() => {
  const mockInstantiate = vi.fn();
  const mockRegisterFileHandle = vi.fn();
  const mockConnect = vi.fn();
  const mockDbTerminate = vi.fn();
  // QNBS-v3: [Must be a `function`, not an arrow — arrow functions aren't constructable, and initDuckDb() calls `new AsyncDuckDB(...)`.]
  const MockAsyncDuckDB = vi.fn().mockImplementation(function MockAsyncDuckDBCtor() {
    return {
      instantiate: mockInstantiate,
      registerFileHandle: mockRegisterFileHandle,
      connect: mockConnect,
      terminate: mockDbTerminate,
    };
  });
  return {
    mockSelectBundle: vi.fn(),
    mockInstantiate,
    mockRegisterFileHandle,
    mockConnect,
    mockDbTerminate,
    MockAsyncDuckDB,
  };
});

vi.mock('@duckdb/duckdb-wasm', () => ({
  AsyncDuckDB: MockAsyncDuckDB,
  selectBundle: mockSelectBundle,
  ConsoleLogger: vi.fn(),
  DuckDBDataProtocol: { BROWSER_FSACCESS: 'browser-fsaccess' },
}));

// QNBS-v3: [Imported after the mock is declared so the worker picks up the mocked module.]
import {
  handleExec,
  handleQuery,
  handleShutdown,
  initDuckDb,
} from '../../workers/v2/duckdb.worker';

function makeCtx(overrides: Partial<WorkerHandlerContext> = {}): WorkerHandlerContext {
  return {
    taskId: 't1',
    taskType: 'db.duckdb.query',
    payload: {},
    signal: new AbortController().signal,
    emitProgress: vi.fn(),
    ...overrides,
  };
}

function stubOpfsDirectory(getFileHandle: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { getDirectory: vi.fn().mockResolvedValue({ getFileHandle }) },
    configurable: true,
  });
}

function stubNoOpfs(): void {
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: undefined,
    configurable: true,
  });
}

// QNBS-v3: [Always include `close` — the shared beforeEach calls handleShutdown() to reset state, which unconditionally calls `connection?.close()`.]
function mockConnection(overrides: { query?: ReturnType<typeof vi.fn> } = {}) {
  return { query: overrides.query ?? vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
}

describe('duckdb.worker handlers', () => {
  beforeEach(async () => {
    // QNBS-v3: [connection/db are module-scoped and persist across tests — reset first so "not initialized" assertions aren't polluted by a prior test's initDuckDb().]
    await handleShutdown();
    vi.clearAllMocks();
    mockSelectBundle.mockResolvedValue({ mainModule: 'mvp.wasm', mainWorker: 'mvp.worker.js' });
    mockInstantiate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stubNoOpfs();
  });

  describe('initDuckDb', () => {
    it('attaches OPFS persistence and does not emit opfs-fallback when it succeeds', async () => {
      const connectionQuery = vi.fn().mockResolvedValue(undefined);
      mockConnect.mockResolvedValue(mockConnection({ query: connectionQuery }));
      mockRegisterFileHandle.mockResolvedValue(undefined);
      stubOpfsDirectory(vi.fn().mockResolvedValue({}));
      const emitProgress = vi.fn();

      await initDuckDb(emitProgress);

      expect(connectionQuery).toHaveBeenCalledWith(expect.stringContaining('ATTACH'));
      expect(emitProgress).not.toHaveBeenCalled();
    });

    it('emits opfs-fallback and still connects when registerFileHandle throws', async () => {
      mockConnect.mockResolvedValue(mockConnection());
      mockRegisterFileHandle.mockRejectedValue(new Error('registerFileHandle denied'));
      stubOpfsDirectory(vi.fn().mockResolvedValue({}));
      const emitProgress = vi.fn();

      await initDuckDb(emitProgress);

      expect(emitProgress).toHaveBeenCalledWith('opfs-fallback', 1, 'registerFileHandle denied');
      // Falls back to a plain (in-memory) connect() despite the OPFS failure.
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('closes the partially-initialized OPFS connection before falling back when ATTACH fails', async () => {
      const opfsClose = vi.fn().mockResolvedValue(undefined);
      const opfsQuery = vi.fn().mockRejectedValue(new Error('ATTACH failed'));
      mockConnect
        .mockResolvedValueOnce({ query: opfsQuery, close: opfsClose })
        .mockResolvedValueOnce(mockConnection());
      mockRegisterFileHandle.mockResolvedValue(undefined);
      stubOpfsDirectory(vi.fn().mockResolvedValue({}));
      const emitProgress = vi.fn();

      await initDuckDb(emitProgress);

      expect(opfsClose).toHaveBeenCalled();
      expect(emitProgress).toHaveBeenCalledWith('opfs-fallback', 1, 'ATTACH failed');
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('still falls back and emits the original OPFS error when close() itself rejects', async () => {
      const opfsClose = vi.fn().mockRejectedValue(new Error('close also failed'));
      const opfsQuery = vi.fn().mockRejectedValue(new Error('ATTACH failed'));
      mockConnect
        .mockResolvedValueOnce({ query: opfsQuery, close: opfsClose })
        .mockResolvedValueOnce(mockConnection());
      mockRegisterFileHandle.mockResolvedValue(undefined);
      stubOpfsDirectory(vi.fn().mockResolvedValue({}));
      const emitProgress = vi.fn();

      await expect(initDuckDb(emitProgress)).resolves.toBeUndefined();

      expect(opfsClose).toHaveBeenCalled();
      // The original ATTACH error reaches emitProgress, not the close() failure.
      expect(emitProgress).toHaveBeenCalledWith('opfs-fallback', 1, 'ATTACH failed');
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('does not emit opfs-fallback when OPFS is simply unsupported (no navigator.storage)', async () => {
      mockConnect.mockResolvedValue(mockConnection());
      stubNoOpfs();
      const emitProgress = vi.fn();

      await initDuckDb(emitProgress);

      expect(emitProgress).not.toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('works when emitProgress is omitted (registerTaskHandler always passes ctx.emitProgress, but keep the param optional/safe)', async () => {
      mockConnect.mockResolvedValue(
        mockConnection({ query: vi.fn().mockRejectedValue(new Error('boom')) }),
      );
      mockRegisterFileHandle.mockResolvedValue(undefined);
      stubOpfsDirectory(vi.fn().mockResolvedValue({}));

      await expect(initDuckDb()).resolves.toBeUndefined();
    });
  });

  describe('handleQuery', () => {
    it('throws when DuckDB is not initialized', async () => {
      await expect(handleQuery(makeCtx({ payload: { sql: 'select 1' } }))).rejects.toThrow(
        'DuckDB not initialized',
      );
    });

    it('returns a raw array of plain-object rows (not a {ok,rows} wrapper)', async () => {
      const row = { toJSON: () => ({ id: 1 }) };
      mockConnect.mockResolvedValue(
        mockConnection({ query: vi.fn().mockResolvedValue({ toArray: () => [row] }) }),
      );
      stubNoOpfs();
      await initDuckDb();

      const result = await handleQuery(makeCtx({ payload: { sql: 'select 1' } }));

      expect(result).toEqual([{ id: 1 }]);
    });

    it('throws (does not resolve {ok:false}) when the query rejects', async () => {
      mockConnect.mockResolvedValue(
        mockConnection({ query: vi.fn().mockRejectedValue(new Error('bad sql')) }),
      );
      stubNoOpfs();
      await initDuckDb();

      await expect(handleQuery(makeCtx({ payload: { sql: 'garbage' } }))).rejects.toThrow(
        'bad sql',
      );
    });

    it('binds params via a prepared statement instead of dropping them', async () => {
      const row = { toJSON: () => ({ id: 1 }) };
      const stmtQuery = vi.fn().mockResolvedValue({ toArray: () => [row] });
      const stmtClose = vi.fn().mockResolvedValue(undefined);
      const prepare = vi.fn().mockResolvedValue({ query: stmtQuery, close: stmtClose });
      const rawQuery = vi.fn();
      mockConnect.mockResolvedValue({
        query: rawQuery,
        close: vi.fn().mockResolvedValue(undefined),
        prepare,
      });
      stubNoOpfs();
      await initDuckDb();

      const result = await handleQuery(
        makeCtx({ payload: { sql: 'select * from t where id = ?', params: [1] } }),
      );

      expect(prepare).toHaveBeenCalledWith('select * from t where id = ?');
      expect(stmtQuery).toHaveBeenCalledWith(1);
      expect(stmtClose).toHaveBeenCalled();
      expect(rawQuery).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
    });

    it('closes the prepared statement even when the bound query rejects', async () => {
      const stmtQuery = vi.fn().mockRejectedValue(new Error('bind failed'));
      const stmtClose = vi.fn().mockResolvedValue(undefined);
      const prepare = vi.fn().mockResolvedValue({ query: stmtQuery, close: stmtClose });
      mockConnect.mockResolvedValue({
        query: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        prepare,
      });
      stubNoOpfs();
      await initDuckDb();

      await expect(
        handleQuery(makeCtx({ payload: { sql: 'select ?', params: ['x'] } })),
      ).rejects.toThrow('bind failed');
      expect(stmtClose).toHaveBeenCalled();
    });

    it('does not use a prepared statement when params is an empty array', async () => {
      const row = { toJSON: () => ({ id: 1 }) };
      const rawQuery = vi.fn().mockResolvedValue({ toArray: () => [row] });
      const prepare = vi.fn();
      mockConnect.mockResolvedValue({
        query: rawQuery,
        close: vi.fn().mockResolvedValue(undefined),
        prepare,
      });
      stubNoOpfs();
      await initDuckDb();

      await handleQuery(makeCtx({ payload: { sql: 'select 1', params: [] } }));

      expect(prepare).not.toHaveBeenCalled();
      expect(rawQuery).toHaveBeenCalledWith('select 1');
    });
  });

  describe('handleExec', () => {
    it('throws when DuckDB is not initialized', async () => {
      await expect(
        handleExec(makeCtx({ payload: { sql: 'insert into t values (1)' } })),
      ).rejects.toThrow('DuckDB not initialized');
    });

    it('returns {ok:true} on success', async () => {
      const connectionQuery = vi.fn().mockResolvedValue(undefined);
      mockConnect.mockResolvedValue(mockConnection({ query: connectionQuery }));
      stubNoOpfs();
      await initDuckDb();

      const result = await handleExec(makeCtx({ payload: { sql: 'create table t (id int)' } }));

      expect(result).toEqual({ ok: true });
      expect(connectionQuery).toHaveBeenCalledWith('create table t (id int)');
    });

    it('binds params via a prepared statement instead of dropping them', async () => {
      const stmtQuery = vi.fn().mockResolvedValue(undefined);
      const stmtClose = vi.fn().mockResolvedValue(undefined);
      const prepare = vi.fn().mockResolvedValue({ query: stmtQuery, close: stmtClose });
      const rawQuery = vi.fn();
      mockConnect.mockResolvedValue({
        query: rawQuery,
        close: vi.fn().mockResolvedValue(undefined),
        prepare,
      });
      stubNoOpfs();
      await initDuckDb();

      const result = await handleExec(
        makeCtx({
          payload: {
            sql: 'insert into ai_telemetry values (?, ?, ?, ?, ?)',
            params: ['task', 'backend', 'model', 12, true],
          },
        }),
      );

      expect(prepare).toHaveBeenCalledWith('insert into ai_telemetry values (?, ?, ?, ?, ?)');
      expect(stmtQuery).toHaveBeenCalledWith('task', 'backend', 'model', 12, true);
      expect(stmtClose).toHaveBeenCalled();
      expect(rawQuery).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });
  });

  describe('handleShutdown', () => {
    it('closes the connection and terminates the db, returning {ok:true}', async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      mockConnect.mockResolvedValue({ query: vi.fn(), close });
      stubNoOpfs();
      await initDuckDb();

      const result = await handleShutdown();

      expect(result).toEqual({ ok: true });
      expect(close).toHaveBeenCalled();
      expect(mockDbTerminate).toHaveBeenCalled();

      // A query after shutdown must throw 'DuckDB not initialized' again.
      await expect(handleQuery(makeCtx({ payload: { sql: 'select 1' } }))).rejects.toThrow(
        'DuckDB not initialized',
      );
    });
  });
});
