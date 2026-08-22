import type { SaveProjectInput } from '../services/storageBackend';
import type { Settings } from '../features/settings/settingsSlice';

type SaveOperation = () => Promise<void>;
type Waiter = {
  generation: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};
type PendingOperation = {
  generation: number;
  operation: SaveOperation;
};

/**
 * QNBS-v3 (#332): serialize persistence per resource while allowing a newer snapshot to supersede
 * a queued older one; this prevents duplicate full-project writes without dropping the latest edit.
 */
export class PersistenceCoordinator {
  private nextGeneration = 0;
  private active: PendingOperation | null = null;
  private queued: PendingOperation | null = null;
  private waiters: Waiter[] = [];

  enqueue(operation: SaveOperation): Promise<void> {
    const generation = ++this.nextGeneration;
    const pending: PendingOperation = { generation, operation };

    const completion = new Promise<void>((resolve, reject) => {
      this.waiters.push({ generation, resolve, reject });
    });

    if (this.active) {
      this.queued = pending;
    } else {
      this.active = pending;
      void this.drain();
    }

    return completion;
  }

  private async drain(): Promise<void> {
    while (this.active) {
      const current = this.active;
      try {
        await current.operation();
        this.resolveThrough(current.generation);
      } catch (error) {
        this.rejectThrough(current.generation, error);
      }

      this.active = this.queued;
      this.queued = null;
    }
  }

  private resolveThrough(generation: number): void {
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.generation <= generation) waiter.resolve();
      else remaining.push(waiter);
    }
    this.waiters = remaining;
  }

  private rejectThrough(generation: number, error: unknown): void {
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.generation <= generation) waiter.reject(error);
      else remaining.push(waiter);
    }
    this.waiters = remaining;
  }
}

export const projectPersistenceCoordinator = new PersistenceCoordinator();
export const settingsPersistenceCoordinator = new PersistenceCoordinator();

export type { SaveProjectInput, Settings };
