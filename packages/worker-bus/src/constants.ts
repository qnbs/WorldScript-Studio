// QNBS-v3: WorkerBus v2 operational constants. Centralized for tuning and testing.

/** Max tasks across all priorities before backpressure rejects non-critical tasks. */
export const MAX_QUEUE_SIZE = 32;

/** Default task timeout (5 min). */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** Circuit breaker trips after this many failures within the window. */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Circuit breaker sliding window (ms). */
export const CIRCUIT_BREAKER_WINDOW_MS = 60_000;

/** Time before circuit breaker allows a half-open test request. */
export const CIRCUIT_BREAKER_RECOVERY_MS = 30_000;

/** Max dead-letter entries persisted to IDB. */
export const DEAD_LETTER_CAPACITY = 64;

/** Low-priority tasks auto-promoted after this many preemptions to prevent starvation. */
export const MAX_PREEMPTIONS = 3;

/** Worker health-check ping interval (ms). */
export const WORKER_PING_INTERVAL_MS = 30_000;

/** Worker pong timeout (ms). */
export const WORKER_PONG_TIMEOUT_MS = 5_000;

/** Idle worker termination timeout (ms). */
export const WORKER_IDLE_TIMEOUT_MS = 120_000;

/** Max workers per pool (inference). Capped by hardwareConcurrency and deviceMemory. */
export const MAX_WORKERS_INFERENCE = 4;

/** Min workers per pool. */
export const MIN_WORKERS = 1;

/** Message protocol version. */
export const PROTOCOL_VERSION = 2;
