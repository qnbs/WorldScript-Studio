// QNBS-v3: Main-thread side protocol handler for WorkerBus v2.
//          Wraps a MessagePort and exposes a typed request/response API.

import { createCancelMessage, createTaskMessage, validateWorkerMessage } from './messageBus';
import type { TaskResult } from './types';

export interface ProtocolHandlerOptions {
  readonly timeoutMs?: number;
}

export class ProtocolHandler {
  private readonly port: MessagePort;
  private readonly pending = new Map<
    string,
    {
      readonly resolve: (value: TaskResult<unknown>) => void;
      readonly reject: (reason: Error) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(port: MessagePort, opts: ProtocolHandlerOptions = {}) {
    this.port = port;
    this.port.addEventListener('message', (event) => this.onMessage(event, opts.timeoutMs));
    this.port.start();
  }

  sendTask<TPayload>(
    taskId: string,
    taskType: string,
    payload: TPayload,
    traceId: string,
    timeoutMs = 300_000,
  ): Promise<TaskResult<unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(taskId);
        reject(new Error('Task timed out'));
      }, timeoutMs);

      this.pending.set(taskId, { resolve, reject, timer });
      this.port.postMessage(createTaskMessage(taskId, taskType, payload, traceId, timeoutMs));
    });
  }

  sendCancel(taskId: string, reason?: string): void {
    this.port.postMessage(createCancelMessage(taskId, reason));
    const pending = this.pending.get(taskId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(taskId);
      pending.reject(new Error('Task cancelled'));
    }
  }

  dispose(): void {
    for (const [taskId, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Protocol handler disposed'));
      this.pending.delete(taskId);
    }
    this.port.close();
  }

  private onMessage(event: MessageEvent, _timeoutMs?: number): void {
    const msg = validateWorkerMessage(event.data);
    if (!msg || msg.kind !== 'RESULT') return;

    const pending = this.pending.get(msg.taskId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(msg.taskId);

    if (msg.success) {
      pending.resolve({
        taskId: msg.taskId,
        success: true,
        result: msg.result,
        latencyMs: msg.latencyMs,
        queueTimeMs: 0,
        layer: 'web',
      });
    } else {
      pending.resolve({
        taskId: msg.taskId,
        success: false,
        error: {
          code: msg.error?.code ?? 'FAILED',
          message: msg.error?.message ?? 'Task failed',
          recoverable: true,
          retryCount: 0,
        },
        latencyMs: msg.latencyMs,
        queueTimeMs: 0,
        layer: 'web',
      });
    }
  }
}
