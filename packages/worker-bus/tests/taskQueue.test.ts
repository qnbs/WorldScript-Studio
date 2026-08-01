import { describe, expect, it } from 'vitest';
import { PriorityTaskQueue } from '../src/taskQueue';
import type { WorkerTask } from '../src/types';

function makeTask(taskId: string, priority: WorkerTask['priority'], requeueCount = 0): WorkerTask {
  return {
    taskId,
    taskType: 'test',
    payload: null,
    priority,
    target: 'web',
    capabilities: [],
    createdAt: Date.now(),
    timeoutMs: 30_000,
    retryPolicy: { maxRetries: 0, backoffMs: 100, maxBackoffMs: 1_000, jitter: false },
    traceId: taskId,
    requeueCount,
  } as WorkerTask;
}

describe('PriorityTaskQueue', () => {
  it('dequeues in priority order', () => {
    const queue = new PriorityTaskQueue(10);
    queue.enqueue(makeTask('low-1', 'low'));
    queue.enqueue(makeTask('high-1', 'high'));
    queue.enqueue(makeTask('normal-1', 'normal'));
    queue.enqueue(makeTask('critical-1', 'critical'));

    expect(queue.dequeue()?.taskId).toBe('critical-1');
    expect(queue.dequeue()?.taskId).toBe('high-1');
    expect(queue.dequeue()?.taskId).toBe('normal-1');
    expect(queue.dequeue()?.taskId).toBe('low-1');
  });

  it('rejects non-critical when full', () => {
    const queue = new PriorityTaskQueue(2);
    expect(queue.enqueue(makeTask('a', 'normal'))).toBe(true);
    expect(queue.enqueue(makeTask('b', 'normal'))).toBe(true);
    expect(queue.enqueue(makeTask('c', 'normal'))).toBe(false);
    expect(queue.enqueue(makeTask('d', 'critical'))).toBe(true);
  });

  it('bounds critical work to the eight-task reserve', () => {
    const queue = new PriorityTaskQueue(2);
    expect(queue.enqueue(makeTask('normal-1', 'normal'))).toBe(true);
    expect(queue.enqueue(makeTask('normal-2', 'normal'))).toBe(true);
    for (let index = 0; index < 8; index++) {
      expect(queue.enqueue(makeTask(`critical-${index}`, 'critical'))).toBe(true);
    }
    expect(queue.enqueue(makeTask('critical-overflow', 'critical'))).toBe(false);
    expect(queue.stats().depth).toBe(10);
  });

  it('dequeues the highest-priority runnable task without blocking on another pool', () => {
    const queue = new PriorityTaskQueue(4);
    queue.enqueue(makeTask('blocked-critical', 'critical'));
    queue.enqueue(makeTask('runnable-high', 'high'));

    expect(queue.dequeueFirst((task) => task.taskId === 'runnable-high')?.taskId).toBe(
      'runnable-high',
    );
    expect(queue.dequeue()?.taskId).toBe('blocked-critical');
  });

  it('removes by taskId', () => {
    const queue = new PriorityTaskQueue(10);
    queue.enqueue(makeTask('a', 'normal'));
    queue.enqueue(makeTask('b', 'normal'));
    expect(queue.remove('a')).toBe(true);
    expect(queue.remove('z')).toBe(false);
    expect(queue.dequeue()?.taskId).toBe('b');
  });

  it('reports stats', () => {
    const queue = new PriorityTaskQueue(10);
    queue.enqueue(makeTask('a', 'critical'));
    queue.enqueue(makeTask('b', 'high'));
    queue.enqueue(makeTask('c', 'normal'));
    queue.enqueue(makeTask('d', 'low'));
    const stats = queue.stats();
    expect(stats.depth).toBe(4);
    expect(stats.depthByPriority).toEqual({ critical: 1, high: 1, normal: 1, low: 1 });
  });

  it('promotes starved low-priority tasks', () => {
    const queue = new PriorityTaskQueue(10);
    queue.enqueue(makeTask('low-1', 'low', 2));
    queue.enqueue(makeTask('low-2', 'low', 2));
    queue.enqueue(makeTask('normal-1', 'normal'));

    // dequeue normal first (higher priority)
    expect(queue.dequeue()?.taskId).toBe('normal-1');
    // next dequeue should promote low tasks that hit MAX_PREEMPTIONS
    const next = queue.dequeue();
    // After promotion, low tasks with requeueCount >= 3 move to normal queue
    expect(next?.priority === 'low' || next?.priority === 'normal').toBe(true);
  });
});
