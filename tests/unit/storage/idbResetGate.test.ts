/**
 * Tests for services/storage/idbResetGate.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetIdbResetGateForTest,
  beginIdbReset,
  endIdbReset,
  isIdbResetInProgress,
  registerIdbConnectionCloser,
} from '../../../services/storage/idbResetGate';

afterEach(() => {
  _resetIdbResetGateForTest();
});

describe('idbResetGate', () => {
  it('reports no reset in progress by default', () => {
    expect(isIdbResetInProgress()).toBe(false);
  });

  it('marks a reset in progress and calls every registered closer', () => {
    const closerA = vi.fn();
    const closerB = vi.fn();
    registerIdbConnectionCloser(closerA);
    registerIdbConnectionCloser(closerB);

    beginIdbReset();

    expect(isIdbResetInProgress()).toBe(true);
    expect(closerA).toHaveBeenCalledTimes(1);
    expect(closerB).toHaveBeenCalledTimes(1);
  });

  it('clears the in-progress flag when a reset ends', () => {
    beginIdbReset();
    expect(isIdbResetInProgress()).toBe(true);

    endIdbReset();

    expect(isIdbResetInProgress()).toBe(false);
  });

  it('lets a closer unregister itself so a later reset does not call it again', () => {
    const closer = vi.fn();
    const unregister = registerIdbConnectionCloser(closer);

    unregister();
    beginIdbReset();

    expect(closer).not.toHaveBeenCalled();
  });

  it('calls a closer registered after a reset already began only on the next reset', () => {
    beginIdbReset();
    const lateCloser = vi.fn();
    registerIdbConnectionCloser(lateCloser);

    expect(lateCloser).not.toHaveBeenCalled();

    endIdbReset();
    beginIdbReset();

    expect(lateCloser).toHaveBeenCalledTimes(1);
  });
});
