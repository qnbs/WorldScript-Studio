import { describe, expect, it } from 'vitest';
import { PersistenceCoordinator } from '../../app/persistenceCoordinator';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// QNBS-v3 (#332): isolate coordinator semantics so ordering and supersession cannot regress silently.
describe('PersistenceCoordinator', () => {
  it('serializes operations for one persistence resource', async () => {
    const coordinator = new PersistenceCoordinator();
    const gate = deferred();
    const events: string[] = [];

    const first = coordinator.enqueue(async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
    });
    const second = coordinator.enqueue(async () => {
      events.push('second:start');
    });

    expect(events).toEqual(['first:start']);
    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(firstResult).toMatchObject({ superseded: true });
    expect(secondResult).toEqual({ superseded: false });
  });

  it('supersedes queued snapshots while resolving every caller after the newest save', async () => {
    const coordinator = new PersistenceCoordinator();
    const gate = deferred();
    const saved: number[] = [];

    const first = coordinator.enqueue(async () => {
      saved.push(1);
      await gate.promise;
    });
    const second = coordinator.enqueue(async () => {
      saved.push(2);
    });
    const third = coordinator.enqueue(async () => {
      saved.push(3);
    });

    gate.resolve();
    const [firstResult, secondResult, thirdResult] = await Promise.all([first, second, third]);

    expect(saved).toEqual([1, 3]);
    expect(firstResult).toMatchObject({ superseded: true });
    expect(secondResult).toMatchObject({ superseded: true });
    expect(thirdResult).toEqual({ superseded: false });
  });

  it('resolves a failed generation as superseded without hiding later queued work', async () => {
    const coordinator = new PersistenceCoordinator();
    const failure = new Error('disk full');
    const gate = deferred();
    const saved: string[] = [];

    const first = coordinator.enqueue(async () => {
      await gate.promise;
      throw failure;
    });
    const second = coordinator.enqueue(async () => {
      saved.push('second');
    });

    gate.resolve();
    await expect(first).resolves.toMatchObject({ superseded: true });
    await expect(second).resolves.toEqual({ superseded: false });
    expect(saved).toEqual(['second']);
  });

  it('rejects the latest failed generation when no successor is queued', async () => {
    const coordinator = new PersistenceCoordinator();
    const failure = new Error('disk full');

    const latest = coordinator.enqueue(async () => {
      throw failure;
    });

    await expect(latest).rejects.toBe(failure);
  });

  // QNBS-v3: a failed superseded waiter settles immediately, but the coordinator keeps running the queued successor in the background — idle() must wait for that too.
  it('idle() waits for a superseding queued operation to finish after the current one fails', async () => {
    const coordinator = new PersistenceCoordinator();
    const failure = new Error('disk full');
    const gate = deferred();
    const secondGate = deferred();
    const saved: string[] = [];

    const first = coordinator.enqueue(async () => {
      await gate.promise;
      throw failure;
    });
    coordinator.enqueue(async () => {
      saved.push('second:start');
      await secondGate.promise;
      saved.push('second:end');
    });

    gate.resolve();
    await expect(first).resolves.toMatchObject({ superseded: true });
    // The failed superseded waiter has already settled, but the second generation is now
    // running in the background — idle() must not resolve until it finishes too.
    expect(saved).toEqual(['second:start']);

    let idleResolved = false;
    const idlePromise = coordinator.idle().then(() => {
      idleResolved = true;
    });
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    secondGate.resolve();
    await idlePromise;
    expect(idleResolved).toBe(true);
    expect(saved).toEqual(['second:start', 'second:end']);
  });

  it('idle() resolves immediately when nothing is active or queued', async () => {
    const coordinator = new PersistenceCoordinator();
    let resolved = false;
    await coordinator.idle().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(true);
  });

  // QNBS-v3 (#553): a waiter superseded after its own failed attempt is resolved, so the terminal outcome of the exact chain that superseded it must be observable — scoped to that chain, never a global mutable field a later chain could overwrite.
  describe('chain-scoped terminal outcome', () => {
    function failingOp(): { run: () => Promise<void>; fail: (error: Error) => void } {
      let fail!: (error: Error) => void;
      const promise = new Promise<void>((_resolve, reject) => {
        fail = reject;
      });
      return { run: () => promise, fail };
    }

    it('A fails -> B succeeds: superseded A observes terminal success', async () => {
      const coordinator = new PersistenceCoordinator();
      const a = failingOp();
      const first = coordinator.enqueue(a.run);
      const second = coordinator.enqueue(async () => {});
      a.fail(new Error('A failed'));

      const result = await first;
      expect(result.superseded).toBe(true);
      await expect(result.chainOutcome).resolves.toEqual({ ok: true });
      await expect(second).resolves.toEqual({ superseded: false });
    });

    it('A fails -> B fails: superseded A observes B’s failure', async () => {
      const coordinator = new PersistenceCoordinator();
      const a = failingOp();
      const first = coordinator.enqueue(a.run);
      const second = coordinator.enqueue(() => Promise.reject(new Error('B failed')));
      a.fail(new Error('A failed'));

      const result = await first;
      await expect(second).rejects.toThrow('B failed');
      await expect(result.chainOutcome).resolves.toEqual({
        ok: false,
        error: new Error('B failed'),
      });
    });

    it('A fails -> queued B replaced by C -> C fails: C’s failure is authoritative', async () => {
      const coordinator = new PersistenceCoordinator();
      const a = failingOp();
      const first = coordinator.enqueue(a.run);
      const replaced = coordinator.enqueue(() => Promise.reject(new Error('B must never run')));
      const third = coordinator.enqueue(() => Promise.reject(new Error('C failed')));
      a.fail(new Error('A failed'));

      const result = await first;
      await expect(replaced).rejects.toThrow('C failed');
      await expect(third).rejects.toThrow('C failed');
      await expect(result.chainOutcome).resolves.toEqual({
        ok: false,
        error: new Error('C failed'),
      });
    });

    it('a later independent chain cannot change an earlier superseded waiter’s outcome', async () => {
      const coordinator = new PersistenceCoordinator();
      const a = failingOp();
      const first = coordinator.enqueue(a.run);
      const second = coordinator.enqueue(async () => {});
      a.fail(new Error('A failed'));
      const result = await first;
      await second;
      await coordinator.idle();

      await expect(
        coordinator.enqueue(() => Promise.reject(new Error('independent chain failed'))),
      ).rejects.toThrow('independent chain failed');
      await expect(result.chainOutcome).resolves.toEqual({ ok: true });
    });
  });
});
