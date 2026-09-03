type SaveOperation = () => Promise<void>;
export type PersistenceResult = { superseded: boolean };
type Waiter = {
  generation: number;
  resolve: (result: PersistenceResult) => void;
  reject: (error: unknown) => void;
};
type PendingOperation = {
  generation: number;
  operation: SaveOperation;
};

// QNBS-v3 (#332): serialize each persistence resource and wait for the newest queued snapshot before resolving.
export class PersistenceCoordinator {
  private nextGeneration = 0;
  private active: PendingOperation | null = null;
  private queued: PendingOperation | null = null;
  private waiters: Waiter[] = [];
  private idleWaiters: Array<() => void> = [];

  // QNBS-v3: rejectThrough fires immediately on failure without waiting for a superseding queued operation — idle() lets a caller wait for the coordinator to genuinely finish before doing something destructive (e.g. reload).
  idle(): Promise<void> {
    if (!this.active && !this.queued) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  enqueue(operation: SaveOperation): Promise<PersistenceResult> {
    const generation = ++this.nextGeneration;
    const pending: PendingOperation = { generation, operation };

    const completion = new Promise<PersistenceResult>((resolve, reject) => {
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
      } catch (error) {
        this.rejectThrough(current.generation, error);
        this.active = this.queued;
        this.queued = null;
        continue;
      }

      const next = this.queued;
      if (next) {
        this.active = next;
        this.queued = null;
        continue;
      }

      this.resolveThrough(current.generation);
      this.active = null;
    }
    const idleWaiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of idleWaiters) resolve();
  }

  private resolveThrough(generation: number): void {
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.generation <= generation) {
        waiter.resolve({ superseded: waiter.generation < generation });
      } else {
        remaining.push(waiter);
      }
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
// QNBS-v3: separate from projectPersistenceCoordinator so a slow non-critical index/analytics write can never queue behind (and delay) the next actual project save; a factory reset still drains it before deleting anything.
export const backgroundWriteCoordinator = new PersistenceCoordinator();
