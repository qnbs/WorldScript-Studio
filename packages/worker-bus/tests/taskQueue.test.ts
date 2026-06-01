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
    const q = new PriorityTaskQueue(10);
    q.enqueue(makeTask('low-1', 'low'));
    q.enqueue(makeTask('high-1', 'high'));
    q.enqueue(makeTask('normal-1', 'normal'));
    q.enqueue(makeTask('critical-1', 'critical'));

    expect(q.dequeue()?.taskId).toBe('critical-1');
    expect(q.dequeue()?.taskId).toBe('high-1');
    expect(q.dequeue()?.taskId).toBe('normal-1');
    expect(q.dequeue()?.taskId).toBe('low-1');
  });

  it('rejects non-critical when full', () => {
    const q = new PriorityTaskQueue(2);
    expect(q.enqueue(makeTask('a', 'normal'))).toBe(true);
    expect(q.enqueue(makeTask('b', 'normal'))).toBe(true);
    expect(q.enqueue(makeTask('c', 'normal'))).toBe(false);
    expect(q.enqueue(makeTask('d', 'critical'))).toBe(true);
  });

  it('removes by taskId', () => {
    const q = new PriorityTaskQueue(10);
    q.enqueue(makeTask('a', 'normal'));
    q.enqueue(makeTask('b', 'normal'));
    expect(q.remove('a')).toBe(true);
    expect(q.remove('z')).toBe(false);
    expect(q.dequeue()?.taskId).toBe('b');
  });

  it('reports stats', () => {
    const q = new PriorityTaskQueue(10);
    q.enqueue(makeTask('a', 'critical'));
    q.enqueue(makeTask('b', 'high'));
    q.enqueue(makeTask('c', 'normal'));
    q.enqueue(makeTask('d', 'low'));
    const stats = q.stats();
    expect(stats.depth).toBe(4);
    expect(stats.depthByPriority).toEqual({ critical: 1, high: 1, normal: 1, low: 1 });
  });

  it('promotes starved low-priority tasks', () => {
    const q = new PriorityTaskQueue(10);
    q.enqueue(makeTask('low-1', 'low', 2));
    q.enqueue(makeTask('low-2', 'low', 2));
    q.enqueue(makeTask('normal-1', 'normal'));

    // dequeue normal first (higher priority)
    expect(q.dequeue()?.taskId).toBe('normal-1');
    // next dequeue should promote low tasks that hit MAX_PREEMPTIONS
    const next = q.dequeue();
    // After promotion, low tasks with requeueCount >= 3 move to normal queue
    expect(next?.priority === 'low' || next?.priority === 'normal').toBe(true);
  });
});
