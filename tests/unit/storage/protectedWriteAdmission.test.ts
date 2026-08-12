import { describe, expect, it } from 'vitest';
import {
  withMigrationAdmission,
  withProtectedWriteAdmission,
} from '../../../services/storage/protectedWriteAdmission';

describe('protectedWriteAdmission', () => {
  it('allows multiple shared (ordinary writer) holders to run concurrently', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const run = () =>
      withProtectedWriteAdmission(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent--;
      });

    await Promise.all([run(), run(), run()]);
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('excludes ordinary writers while a migration batch holds exclusive admission', async () => {
    const order: string[] = [];
    const migration = withMigrationAdmission(async () => {
      order.push('migration-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('migration-end');
    });
    // QNBS-v3: started slightly after the migration so it reliably queues behind the exclusive hold.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const writer = withProtectedWriteAdmission(async () => {
      order.push('writer-start');
      order.push('writer-end');
    });

    await Promise.all([migration, writer]);
    expect(order).toEqual(['migration-start', 'migration-end', 'writer-start', 'writer-end']);
  });

  it('makes an exclusive migration wait for an already-admitted shared writer to finish', async () => {
    const order: string[] = [];
    const writer = withProtectedWriteAdmission(async () => {
      order.push('writer-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('writer-end');
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const migration = withMigrationAdmission(async () => {
      order.push('migration-start');
      order.push('migration-end');
    });

    await Promise.all([writer, migration]);
    expect(order).toEqual(['writer-start', 'writer-end', 'migration-start', 'migration-end']);
  });

  it('propagates the wrapped function result and rethrows its error', async () => {
    await expect(withProtectedWriteAdmission(async () => 'ok')).resolves.toBe('ok');
    await expect(
      withProtectedWriteAdmission(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('falls back to running the callback directly when navigator.locks is unavailable', async () => {
    const original = navigator.locks;
    // @ts-expect-error — simulating an older runtime without the Web Locks API
    delete navigator.locks;
    try {
      const result = await withProtectedWriteAdmission(async () => 'fallback-ok');
      expect(result).toBe('fallback-ok');
      const migrationResult = await withMigrationAdmission(async () => 'migration-fallback-ok');
      expect(migrationResult).toBe('migration-fallback-ok');
    } finally {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});
