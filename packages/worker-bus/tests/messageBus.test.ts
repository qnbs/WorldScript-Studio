import { describe, expect, it, vi } from 'vitest';
import {
  createCancelMessage,
  createPingMessage,
  createPongMessage,
  createProgressMessage,
  createResultMessage,
  createTaskMessage,
  isCancelMessage,
  isPingMessage,
  isPongMessage,
  isProgressMessage,
  isResultMessage,
  isTaskMessage,
  postMessageFromWorker,
  postMessageTyped,
  validateWorkerMessage,
} from '../src/messageBus';

describe('messageBus', () => {
  describe('validateWorkerMessage', () => {
    it('validates a TASK message', () => {
      const msg = createTaskMessage('t-1', 'ai.inference.text', { prompt: 'hello' }, 'trace-1');
      const result = validateWorkerMessage(msg);
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('TASK');
      expect((result as { taskId: string }).taskId).toBe('t-1');
    });

    it('validates a CANCEL message', () => {
      const msg = createCancelMessage('t-1', 'user-cancelled');
      const result = validateWorkerMessage(msg);
      expect(result?.kind).toBe('CANCEL');
    });

    it('validates a PROGRESS message', () => {
      const msg = createProgressMessage('t-1', 'downloading', 0.5, 'halfway');
      const result = validateWorkerMessage(msg);
      expect(result?.kind).toBe('PROGRESS');
    });

    it('validates a RESULT message', () => {
      const msg = createResultMessage('t-1', true, 120, 'generated text');
      const result = validateWorkerMessage(msg);
      expect(result?.kind).toBe('RESULT');
    });

    it('validates a PING message', () => {
      const msg = createPingMessage('t-1');
      const result = validateWorkerMessage(msg);
      expect(result?.kind).toBe('PING');
    });

    it('validates a PONG message', () => {
      const msg = createPongMessage('t-1', Date.now());
      const result = validateWorkerMessage(msg);
      expect(result?.kind).toBe('PONG');
    });

    it('rejects unknown kinds', () => {
      const result = validateWorkerMessage({ kind: 'UNKNOWN', taskId: 'x' });
      expect(result).toBeNull();
    });

    it('rejects malformed messages', () => {
      const result = validateWorkerMessage({ kind: 'TASK' });
      expect(result).toBeNull();
    });

    it('rejects out-of-range progress', () => {
      const msg = createProgressMessage('t-1', 'stage', 1.5);
      const result = validateWorkerMessage(msg);
      expect(result).toBeNull();
    });

    it('rejects negative latency', () => {
      const msg = createResultMessage('t-1', true, -1);
      const result = validateWorkerMessage(msg);
      expect(result).toBeNull();
    });
  });

  describe('type guards', () => {
    it('isTaskMessage returns true for TASK', () => {
      const msg = createTaskMessage('t-1', 'type', {}, 'trace');
      expect(isTaskMessage(msg)).toBe(true);
      expect(isCancelMessage(msg)).toBe(false);
    });

    it('isCancelMessage returns true for CANCEL', () => {
      const msg = createCancelMessage('t-1');
      expect(isCancelMessage(msg)).toBe(true);
      expect(isTaskMessage(msg)).toBe(false);
    });

    it('isProgressMessage returns true for PROGRESS', () => {
      const msg = createProgressMessage('t-1', 'stage', 0.5);
      expect(isProgressMessage(msg)).toBe(true);
    });

    it('isResultMessage returns true for RESULT', () => {
      const msg = createResultMessage('t-1', true, 0);
      expect(isResultMessage(msg)).toBe(true);
    });

    it('isPingMessage returns true for PING', () => {
      const msg = createPingMessage('t-1');
      expect(isPingMessage(msg)).toBe(true);
    });

    it('isPongMessage returns true for PONG', () => {
      const msg = createPongMessage('t-1', 1);
      expect(isPongMessage(msg)).toBe(true);
    });
  });

  describe('postMessageTyped', () => {
    it('posts a message to a mock worker', () => {
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      const msg = createTaskMessage('t-1', 'type', {}, 'trace');
      postMessageTyped(worker, msg);
      expect(worker.postMessage).toHaveBeenCalledWith(msg);
    });

    it('posts with transferables when provided', () => {
      const worker = { postMessage: vi.fn() } as unknown as Worker;
      const msg = createTaskMessage('t-1', 'type', {}, 'trace');
      const buffer = new ArrayBuffer(8);
      postMessageTyped(worker, msg, [buffer]);
      expect(worker.postMessage).toHaveBeenCalledWith(msg, [buffer]);
    });
  });

  describe('postMessageFromWorker', () => {
    it('posts a message from worker self', () => {
      const originalPostMessage = self.postMessage;
      self.postMessage = vi.fn();
      const msg = createTaskMessage('t-1', 'type', {}, 'trace');
      postMessageFromWorker(msg);
      expect(self.postMessage).toHaveBeenCalledWith(msg);
      self.postMessage = originalPostMessage;
    });

    it('posts with transferables from worker self', () => {
      const originalPostMessage = self.postMessage;
      self.postMessage = vi.fn();
      const msg = createTaskMessage('t-1', 'type', {}, 'trace');
      const buffer = new ArrayBuffer(8);
      postMessageFromWorker(msg, [buffer]);
      expect(self.postMessage).toHaveBeenCalledWith(msg, [buffer]);
      self.postMessage = originalPostMessage;
    });
  });
});
