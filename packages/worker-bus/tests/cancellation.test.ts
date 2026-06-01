import { describe, expect, it } from 'vitest';
import { createCancellationToken } from '../src/cancellation';

describe('createCancellationToken', () => {
  it('starts not cancelled', () => {
    const token = createCancellationToken();
    expect(token.isCancelled).toBe(false);
    expect(token.signal.aborted).toBe(false);
  });

  it('cancels with no error', () => {
    const token = createCancellationToken();
    token.cancel();
    expect(token.isCancelled).toBe(true);
    expect(token.signal.aborted).toBe(true);
  });

  it('cancels with a reason', () => {
    const token = createCancellationToken();
    token.cancel('user-request');
    expect(token.isCancelled).toBe(true);
  });

  it('idempotent: second cancel is a no-op', () => {
    const token = createCancellationToken();
    token.cancel('first');
    token.cancel('second');
    expect(token.signal.reason).toBe('first');
  });

  it('AbortSignal event fires', () => {
    const token = createCancellationToken();
    let fired = false;
    token.signal.addEventListener('abort', () => {
      fired = true;
    });
    token.cancel();
    expect(fired).toBe(true);
  });
});
