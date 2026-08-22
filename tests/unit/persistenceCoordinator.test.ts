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
    expect(firstResult).toEqual({ superseded: true });
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
    expect(firstResult).toEqual({ superseded: true });
    expect(secondResult).toEqual({ superseded: true });
    expect(thirdResult).toEqual({ superseded: false });
  });

  it('rejects the failed generation without hiding later queued work', async () => {
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
    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toEqual({ superseded: false });
    expect(saved).toEqual(['second']);
  });
});
