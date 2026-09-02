/**
 * Tests for services/storage/idbResetGate.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetIdbResetGateForTest,
  beginIdbReset,
  currentIdbResetGeneration,
  endIdbReset,
  isIdbResetInProgress,
  registerIdbConnectionCloser,
} from '../../../services/storage/idbResetGate';

vi.mock('../../../services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  _resetIdbResetGateForTest();
});

describe('idbResetGate', () => {
  it('reports no reset in progress by default', () => {
    expect(isIdbResetInProgress()).toBe(false);
  });

  it('marks a reset in progress, advances the generation, and awaits every registered closer before resolving', async () => {
    let resolveCloser: () => void = () => {};
    const closerA = vi.fn();
    const closerB = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCloser = resolve;
        }),
    );
    registerIdbConnectionCloser(closerA);
    registerIdbConnectionCloser(closerB);
    const startGeneration = currentIdbResetGeneration();

    let resetSettled = false;
    const resetPromise = beginIdbReset().then(() => {
      resetSettled = true;
    });

    // QNBS-v3: beginIdbReset must not resolve while an async closer is still in flight.
    await Promise.resolve();
    await Promise.resolve();
    expect(isIdbResetInProgress()).toBe(true);
    expect(currentIdbResetGeneration()).toBe(startGeneration + 1);
    expect(closerA).toHaveBeenCalledTimes(1);
    expect(closerB).toHaveBeenCalledTimes(1);
    expect(resetSettled).toBe(false);

    resolveCloser();
    await resetPromise;
    expect(resetSettled).toBe(true);
  });

  it('clears the in-progress flag when a reset ends, without reverting the generation', async () => {
    await beginIdbReset();
    const generationAfterReset = currentIdbResetGeneration();
    expect(isIdbResetInProgress()).toBe(true);

    endIdbReset();

    expect(isIdbResetInProgress()).toBe(false);
    expect(currentIdbResetGeneration()).toBe(generationAfterReset);
  });

  it('lets a closer unregister itself so a later reset does not call it again', async () => {
    const closer = vi.fn();
    const unregister = registerIdbConnectionCloser(closer);

    unregister();
    await beginIdbReset();

    expect(closer).not.toHaveBeenCalled();
  });

  // QNBS-v3: a connection constructed while a reset is already iterating must not survive that same reset by registering for some future one instead.
  it('invokes a closer registered while a reset is already in progress, against the current reset', async () => {
    let resolveFirstCloser: () => void = () => {};
    registerIdbConnectionCloser(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstCloser = resolve;
        }),
    );
    const resetPromise = beginIdbReset();
    await Promise.resolve();
    expect(isIdbResetInProgress()).toBe(true);

    const lateCloser = vi.fn();
    registerIdbConnectionCloser(lateCloser);

    // QNBS-v3: invoked synchronously against the CURRENT reset — not merely enrolled for a future one.
    expect(lateCloser).toHaveBeenCalledTimes(1);

    resolveFirstCloser();
    await resetPromise;
  });

  it('does not call a closer registered before any reset has ever begun, until beginIdbReset actually runs', () => {
    const closer = vi.fn();
    registerIdbConnectionCloser(closer);
    expect(closer).not.toHaveBeenCalled();
  });

  it('rejects, logs, and stays fail-closed (in progress) when a closer rejects, without stopping other closers', async () => {
    const { logger } = await import('../../../services/logger');
    const failingCloser = vi.fn().mockRejectedValue(new Error('close failed'));
    const okCloser = vi.fn();
    registerIdbConnectionCloser(failingCloser);
    registerIdbConnectionCloser(okCloser);

    // QNBS-v3: beginIdbReset() must fail closed — a caller like wipeAllAppData() relies on this rejection to skip database deletion entirely.
    await expect(beginIdbReset()).rejects.toThrow(/1 closer\(s\) failed/);

    expect(okCloser).toHaveBeenCalledTimes(1);
    expect(isIdbResetInProgress()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('1 connection closer(s) failed'),
      expect.objectContaining({ errors: ['close failed'] }),
    );
  });

  // QNBS-v3: proves every closer still gets its chance to run even when an earlier one fails — the aggregate rejection only surfaces after the full Promise.allSettled round completes.
  it('runs every closer to completion even when an earlier one rejects, before aggregating the failure', async () => {
    const order: string[] = [];
    const failingCloser = vi.fn(async () => {
      order.push('failing-start');
      throw new Error('close failed');
    });
    const slowOkCloser = vi.fn(async () => {
      order.push('slow-start');
      await Promise.resolve();
      order.push('slow-end');
    });
    registerIdbConnectionCloser(failingCloser);
    registerIdbConnectionCloser(slowOkCloser);

    await expect(beginIdbReset()).rejects.toThrow();

    expect(order).toContain('slow-end');
    expect(slowOkCloser).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: the second required invariant — a closer registered mid-reset must join the SAME awaited barrier, not race ahead of it, so beginIdbReset cannot settle (resolve OR reject) while that late closer is still in flight.
  it('does not settle beginIdbReset until a late-registered, deliberately delayed closer also finishes', async () => {
    let resolveLateCloser: () => void = () => {};
    const order: string[] = [];
    registerIdbConnectionCloser(() => {
      order.push('early-closer-ran');
    });
    const resetPromise = beginIdbReset().then(() => {
      order.push('reset-settled');
    });
    await Promise.resolve();
    await Promise.resolve();

    // QNBS-v3: registered AFTER the reset started iterating — must not be deferred to some future reset.
    registerIdbConnectionCloser(
      () =>
        new Promise<void>((resolve) => {
          order.push('late-closer-started');
          resolveLateCloser = resolve;
        }),
    );

    // Give any (incorrect) fire-and-forget path a chance to race ahead before we resolve the late closer.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['early-closer-ran', 'late-closer-started']);
    expect(isIdbResetInProgress()).toBe(true);

    resolveLateCloser();
    await resetPromise;

    expect(order).toEqual(['early-closer-ran', 'late-closer-started', 'reset-settled']);
  });

  // QNBS-v3: the core invariant this module exists for — a stale open cannot become cached once the generation it was captured against is no longer current, even after the reset that advanced it has already ended.
  it('generation mismatch persists after a failed reset ends, so a late-completing open from before it started stays invalidated', async () => {
    const capturedGeneration = currentIdbResetGeneration();

    await beginIdbReset();
    endIdbReset(); // simulates wipeAllAppData() failing before reload

    expect(isIdbResetInProgress()).toBe(false);
    // QNBS-v3: isIdbResetInProgress() alone would wrongly say it's now safe to cache — the generation check is what actually catches this.
    expect(currentIdbResetGeneration()).not.toBe(capturedGeneration);
  });
});
