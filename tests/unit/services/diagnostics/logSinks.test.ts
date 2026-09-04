// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../../../../services/diagnostics/logEntry';

const h = vi.hoisted(() => ({
  isTauri: false,
  writeTextFile: vi.fn(async (_path: string, _data: string, _options?: unknown) => {}),
  mkdir: vi.fn(async (_path: string, _options?: unknown) => {}),
  appDataDir: vi.fn(async () => '/app/data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('../../../../services/desktopPlatform', () => ({
  desktopPlatform: {
    runtime: {
      get isDesktop() {
        return h.isTauri;
      },
    },
    filesystem: {
      mkdir: (...args: [string, unknown?]) => h.mkdir(...args),
      writeTextFile: (...args: [string, string, unknown?]) => h.writeTextFile(...args),
    },
    persistence: {
      appDataDir: () => h.appDataDir(),
      join: (...parts: string[]) => h.join(...parts),
    },
  },
}));

const entry = (message: string): LogEntry => ({
  ts: 1_700_000_000_000,
  level: 'info',
  module: 'sink-test',
  message,
});

function installIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
    writable: true,
  });
}

async function readIdbEntries(): Promise<LogEntry[]> {
  const request = indexedDB.open('worldscript-logs-db');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      const upgradedDb = request.result;
      if (!upgradedDb.objectStoreNames.contains('logs')) {
        upgradedDb.createObjectStore('logs', { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readRequest = db.transaction('logs', 'readonly').objectStore('logs').getAll();
  return new Promise<LogEntry[]>((resolve, reject) => {
    readRequest.onsuccess = () => resolve(readRequest.result as LogEntry[]);
    readRequest.onerror = () => reject(readRequest.error);
  });
}

describe('renderer-specific diagnostics sinks', () => {
  beforeEach(() => {
    h.isTauri = false;
    h.writeTextFile.mockClear();
    h.mkdir.mockClear();
    h.appDataDir.mockClear();
    h.join.mockClear();
    installIndexedDb();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // QNBS-v3: isolated sink tests prove serialized writes preserve ordering and the bounded ring buffer.
  it('writes entries to IndexedDB and keeps the ring buffer bounded', async () => {
    const { writeLogEntryToSinks } = await import('../../../../services/diagnostics/logSinks');

    for (let index = 0; index <= 1_000; index += 1) {
      writeLogEntryToSinks(entry(`log-${index}`));
    }

    await vi.waitFor(
      async () => {
        const entries = await readIdbEntries();
        expect(entries).toHaveLength(1_000);
        expect(entries[0]?.message).toBe('log-1');
        expect(entries.at(-1)?.message).toBe('log-1000');
      },
      { timeout: 10_000, interval: 50 },
    );
  });

  it('serializes concurrent Tauri initialization and JSONL writes', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    h.isTauri = true;
    const { writeLogEntryToSinks } = await import('../../../../services/diagnostics/logSinks');

    writeLogEntryToSinks(entry('first'));
    writeLogEntryToSinks(entry('second'));

    await vi.waitFor(() => expect(h.writeTextFile).toHaveBeenCalledTimes(2));
    expect(h.mkdir).toHaveBeenCalledTimes(1);
    expect(h.writeTextFile.mock.calls[0]?.[1]).toContain('first');
    expect(h.writeTextFile.mock.calls[1]?.[1]).toContain('second');
    expect(h.writeTextFile.mock.calls[0]?.[2]).toEqual({ append: true, create: true });
  });

  it('swallows an IndexedDB open failure so logging never rejects the caller', async () => {
    const request = { error: new Error('IndexedDB unavailable') } as unknown as IDBOpenDBRequest;
    const open = vi.fn(() => {
      queueMicrotask(() => request.onerror?.({ target: request } as unknown as Event));
      return request;
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open },
      writable: true,
    });
    const { writeLogEntryToSinks } = await import('../../../../services/diagnostics/logSinks');

    expect(() => writeLogEntryToSinks(entry('diagnostic failure'))).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(open).toHaveBeenCalledWith('worldscript-logs-db', 1);
  });

  describe('reset-gate interaction', () => {
    // QNBS-v3 (coderabbit): a fixed `await Promise.resolve()` couples these tests to the write queue's exact internal await-depth -- if it ever gains one more await, "during-reset"/"racing-write" would land after all (test 1 fails loudly) or the race would silently stop covering the branch it claims to (test 2, no failure). Both tests now wait on the observable admission-check call itself instead of a fixed tick count.
    it('closes the connection on reset, rejects while draining, and durably reopens afterward', async () => {
      const { writeLogEntryToSinks } = await import('../../../../services/diagnostics/logSinks');
      const idbResetGate = await import('../../../../services/storage/idbResetGate');
      const { beginIdbReset, endIdbReset } = idbResetGate;
      const admissionSpy = vi.spyOn(idbResetGate, 'beginIdbOpenAdmission');

      writeLogEntryToSinks(entry('before-reset'));
      await vi.waitFor(async () => {
        const entries = await readIdbEntries();
        expect(entries.some((e) => e.message === 'before-reset')).toBe(true);
      });

      await beginIdbReset();
      admissionSpy.mockClear();
      // QNBS-v3: a write attempted while still draining must be rejected by beginIdbOpenAdmission(), not silently queued against a closed connection. Waits for the write queue to actually REACH that admission check (observable), not a guessed number of microtask ticks.
      writeLogEntryToSinks(entry('during-reset'));
      await vi.waitFor(() => expect(admissionSpy).toHaveBeenCalled());
      expect(admissionSpy).toHaveReturnedWith(null);
      endIdbReset();

      writeLogEntryToSinks(entry('after-reset'));
      await vi.waitFor(async () => {
        const entries = await readIdbEntries();
        expect(entries.some((e) => e.message === 'after-reset')).toBe(true);
      });
      const entries = await readIdbEntries();
      expect(entries.some((e) => e.message === 'during-reset')).toBe(false);
    });

    // QNBS-v3: exercises the actual generation race -- the reset begins WHILE this open is already in flight, before its onsuccess has fired.
    it('discards an open that races a reset before its onsuccess fires', async () => {
      const { writeLogEntryToSinks } = await import('../../../../services/diagnostics/logSinks');
      const idbResetGate = await import('../../../../services/storage/idbResetGate');
      const { beginIdbReset, endIdbReset } = idbResetGate;
      const admissionSpy = vi.spyOn(idbResetGate, 'beginIdbOpenAdmission');
      const openSpy = vi.spyOn(indexedDB, 'open');

      writeLogEntryToSinks(entry('racing-write'));
      // QNBS-v3 (coderabbit): waits for the ACTUAL indexedDB.open() call (observable), not a guessed microtask count -- a microtask-paced poll rather than vi.waitFor's real-time (50ms) interval, since fake-indexeddb's own onsuccess can fire faster than that and would otherwise be missed. Proves the open genuinely started (and was admitted) BEFORE the reset's generation bump, so the later discard is provably via the onsuccess generation check, not via admission rejecting a not-yet-started open.
      while (openSpy.mock.calls.length === 0) {
        await Promise.resolve();
      }
      expect(admissionSpy).toHaveReturnedWith(expect.any(Number));
      await beginIdbReset();
      endIdbReset();

      writeLogEntryToSinks(entry('after-reset'));
      await vi.waitFor(async () => {
        const entries = await readIdbEntries();
        expect(entries.some((e) => e.message === 'after-reset')).toBe(true);
      });
      const entries = await readIdbEntries();
      expect(entries.some((e) => e.message === 'racing-write')).toBe(false);
    });
  });
});
