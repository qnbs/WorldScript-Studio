// QNBS-v3: Strongly typed postMessage wrapper with Zod validation.
//          All worker ↔ main-thread communication goes through this layer.

import { type WorkerMessage, WorkerMessageSchema } from './schemas';

// --- Validation -------------------------------------------------------------

/**
 * Validates an unknown payload against the WorkerMessage schema.
 * Returns the parsed message or null if invalid.
 */
export function validateWorkerMessage(data: unknown): WorkerMessage | null {
  const parsed = WorkerMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

// --- Typed postMessage ------------------------------------------------------

/**
 * Sends a validated WorkerMessage to a Worker with optional Transferable objects.
 */
export function postMessageTyped(
  worker: Worker,
  message: WorkerMessage,
  transferables?: readonly Transferable[],
): void {
  if (transferables !== undefined && transferables.length > 0) {
    // QNBS-v3: cast readonly → mutable because postMessage overload expects Transferable[] not readonly
    worker.postMessage(message, transferables as Transferable[]);
  } else {
    worker.postMessage(message);
  }
}

/**
 * Sends a WorkerMessage from inside a worker to the main thread.
 */
export function postMessageFromWorker(
  message: WorkerMessage,
  transferables?: readonly Transferable[],
): void {
  if (transferables !== undefined && transferables.length > 0) {
    // eslint-disable-next-line no-restricted-globals
    self.postMessage(message, transferables as Transferable[]);
  } else {
    // eslint-disable-next-line no-restricted-globals
    self.postMessage(message);
  }
}

// --- Message factories ------------------------------------------------------

export function createTaskMessage(
  taskId: string,
  taskType: string,
  payload: unknown,
  traceId: string,
  timeoutMs = 300_000,
): WorkerMessage {
  return {
    kind: 'TASK',
    taskId,
    taskType,
    payload,
    traceId,
    timeoutMs,
  };
}

export function createCancelMessage(taskId: string, reason?: string): WorkerMessage {
  return { kind: 'CANCEL', taskId, reason };
}

export function createPingMessage(taskId: string): WorkerMessage {
  return { kind: 'PING', taskId };
}

export function createPongMessage(taskId: string, ts: number): WorkerMessage {
  return { kind: 'PONG', taskId, ts };
}

export function createProgressMessage(
  taskId: string,
  stage: string,
  progress: number,
  message?: string,
): WorkerMessage {
  return { kind: 'PROGRESS', taskId, stage, progress, message };
}

export function createResultMessage(
  taskId: string,
  success: boolean,
  latencyMs: number,
  result?: unknown,
  error?: { code: string; message: string },
): WorkerMessage {
  return { kind: 'RESULT', taskId, success, result, error, latencyMs };
}

// --- Utility guards ---------------------------------------------------------

export function isTaskMessage(msg: WorkerMessage): msg is Extract<WorkerMessage, { kind: 'TASK' }> {
  return msg.kind === 'TASK';
}

export function isCancelMessage(
  msg: WorkerMessage,
): msg is Extract<WorkerMessage, { kind: 'CANCEL' }> {
  return msg.kind === 'CANCEL';
}

export function isProgressMessage(
  msg: WorkerMessage,
): msg is Extract<WorkerMessage, { kind: 'PROGRESS' }> {
  return msg.kind === 'PROGRESS';
}

export function isResultMessage(
  msg: WorkerMessage,
): msg is Extract<WorkerMessage, { kind: 'RESULT' }> {
  return msg.kind === 'RESULT';
}

export function isPingMessage(msg: WorkerMessage): msg is Extract<WorkerMessage, { kind: 'PING' }> {
  return msg.kind === 'PING';
}

export function isPongMessage(msg: WorkerMessage): msg is Extract<WorkerMessage, { kind: 'PONG' }> {
  return msg.kind === 'PONG';
}
