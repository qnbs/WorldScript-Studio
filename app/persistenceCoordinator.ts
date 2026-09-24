type SaveOperation = () => Promise<void>;
export type ChainOutcome = { ok: true } | { ok: false; error: unknown };
/**
 * `chainOutcome` is the terminal outcome of the exact drain chain this waiter belonged to — the
 * newest operation that chain ran before the queue emptied. It is present whenever a waiter is
 * `superseded`, because a superseded waiter can be resolved even though its own attempt failed.
 */
export type PersistenceResult = { superseded: boolean; chainOutcome?: Promise<ChainOutcome> };
type Waiter = {
  generation: number;
  resolve: (result: PersistenceResult) => void;
  reject: (error: unknown) => void;
};
type PendingOperation = {
  generation: number;
  operation: SaveOperation;
};
type Chain = { outcome: Promise<ChainOutcome>; settle: (outcome: ChainOutcome) => void };

function openChain(): Chain {
  let settle!: (outcome: ChainOutcome) => void;
  const outcome = new Promise<ChainOutcome>((resolve) => {
    settle = resolve;
  });
  return { outcome, settle };
}

// QNBS-v3 (#332): serialize each persistence resource and wait for the newest queued snapshot before resolving.
export class PersistenceCoordinator {
  private nextGeneration = 0;
  private active: PendingOperation | null = null;
  private queued: PendingOperation | null = null;
  private waiters: Waiter[] = [];
  private idleWaiters: Array<() => void> = [];
  // QNBS-v3 (#553): one chain per uninterrupted drain, from the first operation until the queue is empty. A waiter superseded mid-chain holds this chain's own outcome promise, so a later, independent chain can never overwrite what that waiter observes — unlike a single mutable "last outcome" field.
  private chain: Chain | null = null;

  // QNBS-v3: settle failed waiters immediately; older waiters become superseded when a queued successor exists, while idle() still waits for that successor before destructive work (e.g. reload).
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
      this.chain = openChain();
      void this.drain();
    }

    return completion;
  }

  private async drain(): Promise<void> {
    const chain = this.chain as Chain;
    let terminal: ChainOutcome = { ok: true };
    while (this.active) {
      const current = this.active;
      try {
        await current.operation();
      } catch (error) {
        const next = this.queued;
        if (next) {
          // QNBS-v3: a failed snapshot is not user-visible when a newer queued snapshot will take over; rejecting it would clear the shared saving state and show a false failure while the successor is still running.
          this.resolveThrough(current.generation, chain, true);
        } else {
          terminal = { ok: false, error };
          this.rejectThrough(current.generation, error);
        }
        this.active = next;
        this.queued = null;
        continue;
      }

      const next = this.queued;
      if (next) {
        this.active = next;
        this.queued = null;
        continue;
      }

      terminal = { ok: true };
      this.resolveThrough(current.generation, chain);
      this.active = null;
    }
    this.chain = null;
    chain.settle(terminal);
    const idleWaiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of idleWaiters) resolve();
  }

  private resolveThrough(generation: number, chain: Chain, superseded = false): void {
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.generation <= generation) {
        const isSuperseded = superseded || waiter.generation < generation;
        waiter.resolve(
          isSuperseded ? { superseded: true, chainOutcome: chain.outcome } : { superseded: false },
        );
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
// QNBS-v3: separate from projectPersistenceCoordinator so a slow non-critical write can never queue behind (and delay) the next actual project save; a factory reset still drains both before deleting anything.
// QNBS-v3: kept as two distinct coordinators, not one shared instance -- enqueue() retains only a single queued slot, so sharing one between indexing and DuckDB writes let a later write of one kind silently discard an already-queued write of the other.
export const crossProjectIndexCoordinator = new PersistenceCoordinator();
export const duckDbWriteCoordinator = new PersistenceCoordinator();
