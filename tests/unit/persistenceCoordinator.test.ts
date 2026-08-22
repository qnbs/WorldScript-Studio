import { describe, expect, it } from 'vitest';
import { PersistenceCoordinator } from '../../app/persistenceCoordinator';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
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
    await Promise.all([first, second, third]);

    expect(saved).toEqual([1, 3]);
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
    await expect(second).resolves.toBeUndefined();
    expect(saved).toEqual(['second']);
  });
});
