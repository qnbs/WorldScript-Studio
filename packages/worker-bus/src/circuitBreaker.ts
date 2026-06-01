// QNBS-v3: Per-task-type circuit breaker. Prevents cascading failures under load.

import {
  CIRCUIT_BREAKER_RECOVERY_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_WINDOW_MS,
} from './constants';
import type { CircuitBreakerState } from './types';

interface FailureRecord {
  readonly ts: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failures: FailureRecord[] = [];
  private lastFailureAt = 0;
  private halfOpenTestPending = false;

  constructor(
    private readonly threshold = CIRCUIT_BREAKER_THRESHOLD,
    private readonly windowMs = CIRCUIT_BREAKER_WINDOW_MS,
    private readonly recoveryMs = CIRCUIT_BREAKER_RECOVERY_MS,
  ) {}

  getState(): CircuitBreakerState {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt >= this.recoveryMs) {
        this.state = 'half-open';
        this.halfOpenTestPending = false;
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const s = this.getState();
    if (s === 'closed') return true;
    if (s === 'open') return false;
    // half-open: allow exactly one test request
    if (this.halfOpenTestPending) return false;
    this.halfOpenTestPending = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = [];
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.halfOpenTestPending = false;
    }
  }

  recordFailure(): void {
    const now = Date.now();
    this.lastFailureAt = now;
    this.failures.push({ ts: now });
    // prune old failures outside window
    const cutoff = now - this.windowMs;
    this.failures = this.failures.filter((f) => f.ts > cutoff);

    if (this.failures.length >= this.threshold) {
      this.state = 'open';
      this.halfOpenTestPending = false;
    } else if (this.state === 'half-open') {
      // test request failed → back to open immediately
      this.state = 'open';
      this.halfOpenTestPending = false;
    }
  }
}
