/// <reference lib="webworker" />
// QNBS-v3: WorkerBus v2 bootstrap. All v2 workers import this to get typed message dispatch.
//          Receives INIT_PORT, then listens on the dedicated MessagePort.

import {
  createPongMessage,
  createProgressMessage,
  createResultMessage,
  isCancelMessage,
  isPingMessage,
  isTaskMessage,
  validateWorkerMessage,
} from './messageBus';

export interface WorkerHandlerContext {
  readonly taskId: string;
  readonly taskType: string;
  readonly payload: unknown;
  readonly signal: AbortSignal;
  readonly emitProgress: (stage: string, progress: number, message?: string) => void;
}

export type WorkerTaskHandler = (ctx: WorkerHandlerContext) => Promise<unknown>;

interface HandlerEntry {
  readonly handler: WorkerTaskHandler;
  readonly capabilities: readonly string[];
}

// QNBS-v3: Mutable module state — workers are singletons, so module-level state is correct.
let port: MessagePort | null = null;
const registry = new Map<string, HandlerEntry>();
const abortControllers = new Map<string, AbortController>();

function getPort(): MessagePort {
  if (!port) throw new Error('Worker not initialized — INIT_PORT missing');
  return port;
}

export function registerTaskHandler(
  taskType: string,
  handler: WorkerTaskHandler,
  capabilities: readonly string[] = [],
): void {
  registry.set(taskType, { handler, capabilities });
}

export function deregisterTaskHandler(taskType: string): void {
  registry.delete(taskType);
}

function handleCancel(taskId: string, _reason?: string): void {
  const controller = abortControllers.get(taskId);
  if (controller) {
    controller.abort();
    abortControllers.delete(taskId);
  }
}

async function handleTask(msg: {
  taskId: string;
  taskType: string;
  payload: unknown;
}): Promise<void> {
  const entry = registry.get(msg.taskType);
  if (!entry) {
    getPort().postMessage(
      createResultMessage(msg.taskId, false, 0, undefined, {
        code: 'UNKNOWN_TASK',
        message: `No handler registered for ${msg.taskType}`,
      }),
    );
    return;
  }

  const controller = new AbortController();
  abortControllers.set(msg.taskId, controller);
  const startedAt = performance.now();

  try {
    const result = await entry.handler({
      taskId: msg.taskId,
      taskType: msg.taskType,
      payload: msg.payload,
      signal: controller.signal,
      emitProgress: (stage, progress, message) => {
        getPort().postMessage(createProgressMessage(msg.taskId, stage, progress, message));
      },
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    getPort().postMessage(createResultMessage(msg.taskId, true, latencyMs, result));
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    getPort().postMessage(
      createResultMessage(msg.taskId, false, latencyMs, undefined, {
        code: 'WORKER_ERROR',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  } finally {
    abortControllers.delete(msg.taskId);
  }
}

function onPortMessage(event: MessageEvent): void {
  const msg = validateWorkerMessage(event.data);
  if (!msg) return;

  if (isPingMessage(msg)) {
    getPort().postMessage(createPongMessage(msg.taskId, Date.now()));
    return;
  }

  if (isCancelMessage(msg)) {
    handleCancel(msg.taskId, msg.reason);
    return;
  }

  if (isTaskMessage(msg)) {
    void handleTask(msg);
    return;
  }
}

// QNBS-v3: First message from main thread must be INIT_PORT with the dedicated port.
self.addEventListener('message', function initHandler(event: MessageEvent) {
  if (event.data?.kind === 'INIT_PORT' && event.data?.port instanceof MessagePort) {
    port = event.data.port as MessagePort;
    port.addEventListener('message', onPortMessage);
    port.start();
    self.removeEventListener('message', initHandler);
  }
});

/**
 * Explicitly start the worker bootstrap on a given port (for tests or non-standard init).
 * Returns a cleanup function that removes the listener.
 */
export function workerBootstrap(initPort?: MessagePort): () => void {
  if (initPort) {
    port = initPort;
    port.addEventListener('message', onPortMessage as EventListener);
    port.start();
  }
  return () => {
    if (port) {
      port.removeEventListener('message', onPortMessage as EventListener);
      port = null;
    }
  };
}

// QNBS-v3: Test-only reset to allow re-initialization in unit tests.
export function __resetWorkerState(): void {
  port = null;
  registry.clear();
  abortControllers.clear();
}
