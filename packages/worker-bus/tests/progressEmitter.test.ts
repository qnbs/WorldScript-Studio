import { describe, expect, it } from 'vitest';
import { ProgressEmitter } from '../src/progressEmitter';
import type { TaskProgress } from '../src/types';

function makeProgress(taskId: string, progress: number): TaskProgress {
  return { taskId, taskType: 'test', stage: 'running', progress, timestamp: Date.now() };
}

describe('ProgressEmitter', () => {
  it('emits to registered listeners', () => {
    const emitter = new ProgressEmitter();
    const received: TaskProgress[] = [];
    emitter.on('t-1', (p) => received.push(p));
    emitter.emit('t-1', makeProgress('t-1', 0.5));
    expect(received).toHaveLength(1);
    expect(received[0]?.progress).toBe(0.5);
  });

  it('does not emit to removed listeners', () => {
    const emitter = new ProgressEmitter();
    const received: TaskProgress[] = [];
    const off = emitter.on('t-1', (p) => received.push(p));
    off();
    emitter.emit('t-1', makeProgress('t-1', 0.5));
    expect(received).toHaveLength(0);
  });

  it('isolates listeners per taskId', () => {
    const emitter = new ProgressEmitter();
    const receivedA: TaskProgress[] = [];
    const receivedB: TaskProgress[] = [];
    emitter.on('a', (p) => receivedA.push(p));
    emitter.on('b', (p) => receivedB.push(p));
    emitter.emit('a', makeProgress('a', 0.1));
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it('async iterable yields progress events', async () => {
    const emitter = new ProgressEmitter();
    const iter = emitter.iterable('t-1');
    const reader = iter[Symbol.asyncIterator]();

    emitter.emit('t-1', makeProgress('t-1', 0.1));
    const first = await reader.next();
    expect(first.value.progress).toBe(0.1);
  });

  it('async iterable resolves next() when emit happens after next()', async () => {
    const emitter = new ProgressEmitter();
    const iter = emitter.iterable('t-1');
    const reader = iter[Symbol.asyncIterator]();

    const nextPromise = reader.next();
    emitter.emit('t-1', makeProgress('t-1', 0.2));
    const result = await nextPromise;
    expect(result.value.progress).toBe(0.2);
  });

  it('async iterable return() ends iteration', async () => {
    const emitter = new ProgressEmitter();
    const iter = emitter.iterable('t-1');
    const reader = iter[Symbol.asyncIterator]();

    const ended = await reader.return!();
    expect(ended.done).toBe(true);

    // After return, next() should also be done
    const next = await reader.next();
    expect(next.done).toBe(true);
  });

  it('off removes a specific listener', () => {
    const emitter = new ProgressEmitter();
    const received: TaskProgress[] = [];
    const listener = (p: TaskProgress) => received.push(p);
    emitter.on('t-1', listener);
    emitter.emit('t-1', makeProgress('t-1', 0.1));
    expect(received).toHaveLength(1);

    emitter.off('t-1', listener);
    emitter.emit('t-1', makeProgress('t-1', 0.2));
    expect(received).toHaveLength(1);
  });

  it('isolates listener errors so other listeners still fire', () => {
    const emitter = new ProgressEmitter();
    const received: TaskProgress[] = [];
    emitter.on('t-1', () => {
      throw new Error('bad listener');
    });
    emitter.on('t-1', (p) => received.push(p));
    emitter.emit('t-1', makeProgress('t-1', 0.5));
    expect(received).toHaveLength(1);
  });

  it('clear removes all listeners', () => {
    const emitter = new ProgressEmitter();
    const received: TaskProgress[] = [];
    emitter.on('t-1', (p) => received.push(p));
    emitter.clear();
    emitter.emit('t-1', makeProgress('t-1', 0.5));
    expect(received).toHaveLength(0);
  });
});
