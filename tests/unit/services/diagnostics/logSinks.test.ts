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
});
