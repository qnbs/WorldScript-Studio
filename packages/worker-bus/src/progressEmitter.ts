// QNBS-v3: Lightweight event-driven progress emitter. No external deps.

import type { TaskProgress } from './types';

type ProgressListener = (progress: TaskProgress) => void;

export class ProgressEmitter {
  private listeners = new Map<string, Set<ProgressListener>>();
  private completionListeners = new Map<string, Set<() => void>>();

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

  complete(taskId: string): void {
    const completionListeners = [...(this.completionListeners.get(taskId) ?? [])];
    for (const listener of completionListeners) listener();
    this.completionListeners.delete(taskId);
    this.listeners.delete(taskId);
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

    const offProgress = this.on(taskId, listener);
    let offComplete: () => void = () => {};
    const finish = (discardBuffered: boolean) => {
      if (done) return;
      done = true;
      if (discardBuffered) emitted.length = 0;
      offProgress();
      offComplete();
      resolveNext?.({ value: undefined, done: true });
      resolveNext = null;
    };
    offComplete = this.onComplete(taskId, () => finish(false));

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
            finish(true);
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
    const taskIds = new Set([...this.listeners.keys(), ...this.completionListeners.keys()]);
    for (const taskId of taskIds) this.complete(taskId);
    this.listeners.clear();
    this.completionListeners.clear();
  }

  private onComplete(taskId: string, listener: () => void): () => void {
    let set = this.completionListeners.get(taskId);
    if (!set) {
      set = new Set();
      this.completionListeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.completionListeners.delete(taskId);
    };
  }
}
