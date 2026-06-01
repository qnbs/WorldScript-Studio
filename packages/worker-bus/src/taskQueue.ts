// QNBS-v3: Priority task queue with starvation prevention and backpressure.

import { MAX_PREEMPTIONS, MAX_QUEUE_SIZE } from './constants';
import type { TaskPriority, WorkerTask } from './types';

export interface QueueStats {
  readonly depth: number;
  readonly depthByPriority: Record<TaskPriority, number>;
}

export class PriorityTaskQueue {
  private queues: Record<TaskPriority, WorkerTask[]> = {
    critical: [],
    high: [],
    normal: [],
    low: [],
  };

  constructor(private readonly maxSize = MAX_QUEUE_SIZE) {}

  enqueue(task: WorkerTask): boolean {
    if (this.totalDepth() >= this.maxSize && task.priority !== 'critical') {
      return false;
    }
    const effectivePriority = this.effectivePriority(task);
    this.queues[effectivePriority].push(task);
    return true;
  }

  dequeue(): WorkerTask | undefined {
    const priorities: TaskPriority[] = ['critical', 'high', 'normal', 'low'];
    for (const p of priorities) {
      const next = this.queues[p].shift();
      if (next !== undefined) {
        // QNBS-v3: increment preemption count for lower-priority tasks that were skipped
        if (p !== 'critical') {
          this.promoteStarvedTasks();
        }
        return next;
      }
    }
    return undefined;
  }

  remove(taskId: string): boolean {
    const priorities: TaskPriority[] = ['critical', 'high', 'normal', 'low'];
    for (const p of priorities) {
      const idx = this.queues[p].findIndex((t) => t.taskId === taskId);
      if (idx !== -1) {
        this.queues[p].splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  peek(): WorkerTask | undefined {
    const priorities: TaskPriority[] = ['critical', 'high', 'normal', 'low'];
    for (const p of priorities) {
      if (this.queues[p].length > 0) {
        return this.queues[p][0];
      }
    }
    return undefined;
  }

  stats(): QueueStats {
    return {
      depth: this.totalDepth(),
      depthByPriority: {
        critical: this.queues.critical.length,
        high: this.queues.high.length,
        normal: this.queues.normal.length,
        low: this.queues.low.length,
      },
    };
  }

  private totalDepth(): number {
    return (
      this.queues.critical.length +
      this.queues.high.length +
      this.queues.normal.length +
      this.queues.low.length
    );
  }

  private effectivePriority(task: WorkerTask): TaskPriority {
    const requeued = (task as unknown as { requeueCount?: number }).requeueCount ?? 0;
    if (task.priority === 'low' && requeued >= MAX_PREEMPTIONS) {
      return 'normal';
    }
    return task.priority;
  }

  private promoteStarvedTasks(): void {
    // QNBS-v3: promote low tasks that have been preempted too many times
    const toPromote: WorkerTask[] = [];
    const remaining: WorkerTask[] = [];
    for (const task of this.queues.low) {
      const requeued = ((task as unknown as { requeueCount?: number }).requeueCount ?? 0) + 1;
      (task as unknown as { requeueCount: number }).requeueCount = requeued;
      if (requeued >= MAX_PREEMPTIONS) {
        toPromote.push(task);
      } else {
        remaining.push(task);
      }
    }
    this.queues.low = remaining;
    this.queues.normal.push(...toPromote);
  }
}
