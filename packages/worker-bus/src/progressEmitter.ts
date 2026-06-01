// QNBS-v3: Lightweight event-driven progress emitter. No external deps.

import type { TaskProgress } from './types';

type ProgressListener = (progress: TaskProgress) => void;

export class ProgressEmitter {
  private listeners = new Map<string, Set<ProgressListener>>();

  on(taskId: string, listener: ProgressListener): () => void {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        this.listeners.delete(taskId);
      }
    };
  }

  off(taskId: string, listener: ProgressListener): void {
    const set = this.listeners.get(taskId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(taskId);
      }
    }
  }

  emit(taskId: string, progress: TaskProgress): void {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(progress);
      } catch {
        // QNBS-v3: isolated per-listener errors so one bad callback doesn't break others
      }
    }
  }

  iterable(taskId: string): AsyncIterable<TaskProgress> {
    const emitted: TaskProgress[] = [];
    let resolveNext: ((value: IteratorResult<TaskProgress>) => void) | null = null;
    let done = false;

    const listener = (p: TaskProgress) => {
      if (done) return;
      if (resolveNext) {
        resolveNext({ value: p, done: false });
        resolveNext = null;
      } else {
        emitted.push(p);
      }
    };

    this.on(taskId, listener);

    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<TaskProgress> {
        return {
          next(): Promise<IteratorResult<TaskProgress>> {
            if (emitted.length > 0) {
              return Promise.resolve({ value: emitted.shift()!, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
          return(): Promise<IteratorResult<TaskProgress>> {
            done = true;
            return Promise.resolve({ value: undefined, done: true });
          },
          [Symbol.asyncIterator](): AsyncIterableIterator<TaskProgress> {
            return this;
          },
        };
      },
    };
  }

  clear(): void {
    this.listeners.clear();
  }
}
