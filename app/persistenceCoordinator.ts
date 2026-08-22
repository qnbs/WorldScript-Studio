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
