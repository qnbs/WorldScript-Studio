import { beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: duckdbClient instantiates a Worker via new URL(…, import.meta.url).
//          We mock the Worker constructor so no real worker is spun up in jsdom.

const mockPostMessage = vi.fn();
const mockTerminate = vi.fn();
const mockAddEventListener = vi.fn();

class MockWorker {
  postMessage = mockPostMessage;
  terminate = mockTerminate;
  addEventListener = mockAddEventListener;
}

vi.stubGlobal('Worker', MockWorker);

// Re-import after stubbing so the module captures MockWorker
const { duckdbClient } = await import('../../services/duckdb/duckdbClient');

beforeEach(() => {
  vi.clearAllMocks();
  // Reset internal worker state between tests
  duckdbClient.terminate();
});

describe('duckdbClient.init', () => {
  it('posts an INIT message with a messageId', async () => {
    const promise = duckdbClient.init();

    // Simulate worker responding synchronously via the message event listener
    const listenerCall = mockAddEventListener.mock.calls.find(([ev]) => ev === 'message');
    expect(listenerCall).toBeDefined();
    const onMessage = listenerCall![1] as (e: MessageEvent) => void;

    // Retrieve the messageId from the postMessage call
    const req = mockPostMessage.mock.calls[0]?.[0] as { messageId: string; type: string };
    expect(req.type).toBe('INIT');

    onMessage({ data: { messageId: req.messageId, ok: true } } as MessageEvent);
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(res.messageId).toBe(req.messageId);
  });
});

describe('duckdbClient.query', () => {
  it('posts a QUERY message and returns rows', async () => {
    const promise = duckdbClient.query('SELECT 1 AS n');

    const listenerCall = mockAddEventListener.mock.calls.find(([ev]) => ev === 'message');
    const onMessage = listenerCall![1] as (e: MessageEvent) => void;
    const req = mockPostMessage.mock.calls[0]?.[0] as { messageId: string; type: string };

    expect(req.type).toBe('QUERY');

    onMessage({
      data: { messageId: req.messageId, ok: true, rows: [{ n: 1 }] },
    } as MessageEvent);

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(res.rows).toEqual([{ n: 1 }]);
  });
});

describe('duckdbClient.exec', () => {
  it('posts an EXEC message', async () => {
    const promise = duckdbClient.exec('CREATE TABLE t (id INTEGER)');

    const listenerCall = mockAddEventListener.mock.calls.find(([ev]) => ev === 'message');
    const onMessage = listenerCall![1] as (e: MessageEvent) => void;
    const req = mockPostMessage.mock.calls[0]?.[0] as { messageId: string; type: string };

    expect(req.type).toBe('EXEC');

    onMessage({ data: { messageId: req.messageId, ok: true } } as MessageEvent);
    const res = await promise;
    expect(res.ok).toBe(true);
  });
});

describe('duckdbClient.shutdown', () => {
  it('posts a SHUTDOWN message', async () => {
    const promise = duckdbClient.shutdown();

    const listenerCall = mockAddEventListener.mock.calls.find(([ev]) => ev === 'message');
    const onMessage = listenerCall![1] as (e: MessageEvent) => void;
    const req = mockPostMessage.mock.calls[0]?.[0] as { messageId: string; type: string };

    expect(req.type).toBe('SHUTDOWN');

    onMessage({ data: { messageId: req.messageId, ok: true } } as MessageEvent);
    const res = await promise;
    expect(res.ok).toBe(true);
  });
});

describe('duckdbClient.terminate', () => {
  it('calls worker.terminate()', async () => {
    // Ensure the worker is created by making a call first
    const promise = duckdbClient.query('SELECT 1');
    const listenerCall = mockAddEventListener.mock.calls.find(([ev]) => ev === 'message');
    const onMessage = listenerCall![1] as (e: MessageEvent) => void;
    const req = mockPostMessage.mock.calls[0]?.[0] as { messageId: string };
    onMessage({ data: { messageId: req.messageId, ok: true, rows: [] } } as MessageEvent);
    await promise;

    duckdbClient.terminate();
    expect(mockTerminate).toHaveBeenCalled();
  });
});

describe('duckdbClient abort', () => {
  it('posts WORKER_CANCEL when AbortSignal fires', async () => {
    const controller = new AbortController();
    void duckdbClient.query('SELECT 1', undefined, controller.signal);

    const req = mockPostMessage.mock.calls[0]?.[0] as { messageId: string };
    controller.abort();

    // The cancel message should be posted after abort
    const cancelMsg = mockPostMessage.mock.calls.find(
      ([m]) => (m as { type: string }).type === 'WORKER_CANCEL',
    );
    expect(cancelMsg).toBeDefined();
    expect((cancelMsg![0] as { messageId: string }).messageId).toBe(req.messageId);
  });
});
