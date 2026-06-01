// QNBS-v3: workerBootstrap is the core worker-side dispatch layer (INIT_PORT, PING/PONG,
//          TASK, CANCEL, emitProgress). We use the exported workerBootstrap(port) overload
//          instead of the self.addEventListener path — designed explicitly for testability.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCancelMessage, createPingMessage, createTaskMessage } from '../src/messageBus';
import {
  __resetWorkerState,
  deregisterTaskHandler,
  registerTaskHandler,
  workerBootstrap,
} from '../src/workerBootstrap';

// QNBS-v3: Mock port that captures the onPortMessage listener and exposes a dispatch helper.
//          Mirrors the MockMessageChannel pattern from workerPool.test.ts but scoped to one port.
function createMockPort() {
  const sent: unknown[] = [];
  let messageHandler: ((evt: MessageEvent) => void) | null = null;

  const port = {
    postMessage: vi.fn((msg: unknown) => {
      sent.push(msg);
    }),
    addEventListener: vi.fn((type: string, handler: EventListener) => {
      if (type === 'message') messageHandler = handler as (evt: MessageEvent) => void;
    }),
    removeEventListener: vi.fn(),
    start: vi.fn(),
  } as unknown as MessagePort;

  return {
    port,
    sent,
    dispatch: (data: unknown) => {
      messageHandler?.(new MessageEvent('message', { data }));
    },
  };
}

// QNBS-v3: Each async handler suspends once per await; 4 flushes covers all realistic chains.
const flushMicrotasks = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('workerBootstrap', () => {
  beforeEach(() => {
    __resetWorkerState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    __resetWorkerState();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── handler registration ────────────────────────────────────────────────

  describe('registerTaskHandler / deregisterTaskHandler', () => {
    it('registers a handler without error', () => {
      const handler = vi.fn().mockResolvedValue({});
      expect(() => registerTaskHandler('type.a', handler)).not.toThrow();
    });

    it('deregistered handler yields UNKNOWN_TASK on dispatch', async () => {
      registerTaskHandler('type.b', vi.fn().mockResolvedValue({}));
      deregisterTaskHandler('type.b');
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('id-1', 'type.b', {}, 'trace-1', 5_000));
      await flushMicrotasks();
      const result = sent[0] as { success: boolean; error: { code: string } };
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('UNKNOWN_TASK');
    });
  });

  // ─── bootstrap init ──────────────────────────────────────────────────────

  describe('workerBootstrap(port)', () => {
    it('calls port.start() on initialisation', () => {
      const { port } = createMockPort();
      const cleanup = workerBootstrap(port);
      expect(port.start).toHaveBeenCalledOnce();
      cleanup();
    });

    it('returned cleanup removes the message listener', () => {
      const { port } = createMockPort();
      const cleanup = workerBootstrap(port);
      cleanup();
      expect(port.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  // ─── PING → PONG ────────────────────────────────────────────────────────

  describe('PING', () => {
    it('responds with WORKER_PONG carrying the same taskId', () => {
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createPingMessage('ping-99'));
      expect(sent).toHaveLength(1);
      const pong = sent[0] as { kind: string; taskId: string };
      expect(pong.kind).toBe('PONG');
      expect(pong.taskId).toBe('ping-99');
    });
  });

  // ─── TASK dispatch ───────────────────────────────────────────────────────

  describe('TASK', () => {
    it('invokes handler and posts WORKER_RESULT success', async () => {
      registerTaskHandler('do.work', vi.fn().mockResolvedValue({ done: true }));
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-1', 'do.work', { x: 7 }, 'trace-t1', 5_000));
      await flushMicrotasks();
      const msg = sent[0] as { kind: string; success: boolean; result: unknown };
      expect(msg.kind).toBe('RESULT');
      expect(msg.success).toBe(true);
      expect(msg.result).toEqual({ done: true });
    });

    it('returns UNKNOWN_TASK when no handler is registered', async () => {
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-2', 'ghost.task', {}, 'trace-t2', 5_000));
      await flushMicrotasks();
      const result = sent[0] as { success: boolean; error: { code: string } };
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('UNKNOWN_TASK');
    });

    it('returns WORKER_ERROR when handler throws', async () => {
      registerTaskHandler('bad.task', async () => {
        throw new Error('handler exploded');
      });
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-3', 'bad.task', {}, 'trace-t3', 5_000));
      await flushMicrotasks();
      const result = sent[0] as { success: boolean; error: { code: string; message: string } };
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('WORKER_ERROR');
      expect(result.error.message).toBe('handler exploded');
    });

    it('forwards taskId, taskType, and payload in the handler context', async () => {
      const handler = vi.fn().mockResolvedValue(null);
      registerTaskHandler('ctx.task', handler);
      const { port, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-4', 'ctx.task', { value: 99 }, 'trace-t4', 5_000));
      await flushMicrotasks();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 't-4',
          taskType: 'ctx.task',
          payload: { value: 99 },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('silently drops messages that fail Zod validation', () => {
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch({ kind: 'BOGUS_KIND', taskId: 'x' });
      expect(sent).toHaveLength(0);
    });
  });

  // ─── CANCEL ─────────────────────────────────────────────────────────────

  describe('CANCEL', () => {
    it('aborts the AbortSignal for a running task synchronously', () => {
      let capturedSignal: AbortSignal | null = null;
      registerTaskHandler('slow.task', ({ signal }) => {
        capturedSignal = signal;
        // QNBS-v3: intentionally never resolves — tests cancel path
        return new Promise<unknown>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });
      const { port, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-5', 'slow.task', {}, 'trace-t5', 5_000));
      // capturedSignal is set synchronously during handler invocation
      dispatch(createCancelMessage('t-5'));
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('posts WORKER_RESULT error after handler rejects on abort', async () => {
      registerTaskHandler('slow2.task', ({ signal }) => {
        return new Promise<unknown>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-6', 'slow2.task', {}, 'trace-t6', 5_000));
      dispatch(createCancelMessage('t-6'));
      await flushMicrotasks();
      const result = sent[0] as { success: boolean; error: { code: string } };
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('WORKER_ERROR');
    });
  });

  // ─── emitProgress ────────────────────────────────────────────────────────

  describe('emitProgress', () => {
    it('posts WORKER_PROGRESS for each call with correct progress values', async () => {
      registerTaskHandler('prog.task', async ({ emitProgress }) => {
        emitProgress('loading', 0.25);
        emitProgress('processing', 0.75, 'almost done');
        return 'complete';
      });
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-7', 'prog.task', {}, 'trace-t7', 5_000));
      await flushMicrotasks();
      const progress = sent.filter((m: unknown) => (m as { kind: string }).kind === 'PROGRESS') as {
        progress: number;
        message?: string;
      }[];
      expect(progress).toHaveLength(2);
      expect(progress[0]!.progress).toBe(0.25);
      expect(progress[1]!.progress).toBe(0.75);
      expect(progress[1]!.message).toBe('almost done');
    });
  });

  // ─── __resetWorkerState ──────────────────────────────────────────────────

  describe('__resetWorkerState', () => {
    it('clears handlers so subsequent tasks get UNKNOWN_TASK', async () => {
      registerTaskHandler('temp.task', vi.fn().mockResolvedValue({}));
      __resetWorkerState();
      const { port, sent, dispatch } = createMockPort();
      workerBootstrap(port);
      dispatch(createTaskMessage('t-8', 'temp.task', {}, 'trace-t8', 5_000));
      await flushMicrotasks();
      const result = sent[0] as { error: { code: string } };
      expect(result.error.code).toBe('UNKNOWN_TASK');
    });
  });
});
