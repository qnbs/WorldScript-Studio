// QNBS-v3: WorkerBus v2 core types — strongly typed task orchestration layer.
//          All messages are versioned and validated via Zod (schemas.ts).

// --- Priorities -------------------------------------------------------------
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

// QNBS-v3: critical = voice/user-initiated; high = UI-blocking;
//          normal = background; low = telemetry
export const PRIORITY_ORDER: readonly TaskPriority[] = ['critical', 'high', 'normal', 'low'];

// --- Task Target ------------------------------------------------------------
export type TaskTarget = 'web' | 'rust' | 'any';

// --- Task State -------------------------------------------------------------
export type TaskState =
  | 'queued'
  | 'routing'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'dead-letter';

// --- Worker Capability ------------------------------------------------------
export type WorkerCapability =
  | 'inference.text'
  | 'inference.embed'
  | 'inference.vision'
  | 'db.duckdb'
  | 'voice.stt'
  | 'voice.tts'
  | 'voice.vad'
  | 'export.epub'
  | 'export.pdf'
  | 'proforge.stage'
  | 'rag.search'
  | 'crypto.pbkdf2'
  | 'plugin.sandbox';

// --- Retry Policy -----------------------------------------------------------
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly maxBackoffMs: number;
  readonly jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  backoffMs: 400,
  maxBackoffMs: 30_000,
  jitter: true,
};

// --- Base Task --------------------------------------------------------------
export interface WorkerTask<TPayload = unknown> {
  readonly taskId: string;
  readonly taskType: string;
  readonly payload: TPayload;
  readonly priority: TaskPriority;
  readonly target: TaskTarget;
  readonly capabilities: readonly WorkerCapability[];
  readonly transferables?: readonly Transferable[] | undefined;
  readonly createdAt: number;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly traceId: string;
  readonly parentTaskId?: string | undefined;
}

// --- Task Error -------------------------------------------------------------
export interface TaskErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly retryCount: number;
}

export class TaskError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly retryCount: number;

  constructor(code: string, message: string, recoverable: boolean, retryCount: number) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
    this.recoverable = recoverable;
    this.retryCount = retryCount;
  }
}

// --- Task Result ------------------------------------------------------------
export interface TaskResult<TResult = unknown> {
  readonly taskId: string;
  readonly success: boolean;
  readonly result?: TResult | undefined;
  readonly error?: TaskErrorInfo | undefined;
  readonly latencyMs: number;
  readonly queueTimeMs: number;
  readonly workerId?: string | undefined;
  readonly layer: 'web' | 'rust' | 'main';
}

// --- Progress ---------------------------------------------------------------
export interface TaskProgress {
  readonly taskId: string;
  readonly taskType: string;
  readonly stage: string;
  readonly progress: number;
  readonly message?: string | undefined;
  readonly timestamp: number;
}

// --- Task Handle (public API) -----------------------------------------------
export interface TaskHandle<TResult = unknown> {
  readonly taskId: string;
  readonly result: Promise<TResult>;
  readonly progress: AsyncIterable<TaskProgress>;
  readonly cancel: (reason?: string) => void;
}

// --- Bus Events --------------------------------------------------------------
export type BusEvent =
  | { kind: 'circuit-breaker-open'; taskType: string }
  | { kind: 'backpressure-rejected'; taskType: string };

export type BusEventListener = (event: BusEvent) => void;

// --- Cancellation -----------------------------------------------------------
export interface CancellationToken {
  readonly signal: AbortSignal;
  readonly cancel: (reason?: string) => void;
  readonly isCancelled: boolean;
}

// --- Worker Bus Options -----------------------------------------------------
export interface WorkerBusOptions {
  readonly maxQueueSize: number;
  readonly maxPreemptions: number;
  readonly workerPoolSize: number;
  readonly enableCircuitBreaker: boolean;
  readonly circuitBreakerThreshold: number;
  readonly circuitBreakerRecoveryMs: number;
  readonly enableDeadLetter: boolean;
  readonly deadLetterCapacity: number;
  readonly enableTracing: boolean;
}

// --- Worker Bus Telemetry ---------------------------------------------------
export interface WorkerBusTelemetry {
  readonly queueDepth: Record<TaskPriority, number>;
  readonly activeWorkers: number;
  readonly idleWorkers: number;
  readonly processedTasks: number;
  readonly failedTasks: number;
  readonly deadLetterCount: number;
  readonly avgQueueTimeMs: number;
  readonly avgExecutionMs: number;
  readonly peakLatencyMs: number;
  readonly errorRate: number;
  readonly circuitBreakerStates: Record<string, 'closed' | 'open' | 'half-open'>;
  readonly lastSuccessAt: number | null;
}

// --- Enqueue Options --------------------------------------------------------
export interface EnqueueOptions {
  readonly priority?: TaskPriority;
  readonly target?: TaskTarget;
  readonly timeoutMs?: number;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly transferables?: Transferable[];
  readonly onProgress?: (progress: TaskProgress) => void;
  readonly parentTaskId?: string;
  readonly capabilities?: readonly WorkerCapability[];
}

// --- Worker Pool ------------------------------------------------------------
export interface WorkerPoolOptions {
  readonly maxWorkers: number;
  readonly minWorkers: number;
  readonly idleTimeoutMs: number;
  readonly workerScript: string;
  readonly capabilities: readonly WorkerCapability[];
  readonly labels: Record<string, string>;
}

export interface PooledWorker {
  readonly workerId: string;
  readonly capabilities: readonly WorkerCapability[];
  readonly state: 'idle' | 'busy' | 'crashed' | 'terminating';
  readonly currentTaskId?: string;
  readonly labels: Readonly<Record<string, string>>;
}

// --- Circuit Breaker State --------------------------------------------------
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

// --- Task Queue Entry (internal) --------------------------------------------
export interface TaskQueueEntry {
  readonly task: WorkerTask;
  readonly handler: TaskHandler;
  readonly retryCount: number;
  readonly enqueuedAt: number;
}

export interface TaskHandler {
  readonly onProgress: (progress: TaskProgress) => void;
  readonly onComplete: (result: TaskResult) => void;
}

// --- Rust Bridge Types ------------------------------------------------------
export interface RustTaskRequest {
  readonly taskId: string;
  readonly taskType: string;
  readonly payload: unknown;
  readonly priority: TaskPriority;
  readonly target: TaskTarget;
  readonly timeoutMs: number;
  readonly retryPolicy?: RetryPolicy;
}

export interface RustTaskProgressEvent {
  readonly taskId: string;
  readonly taskType: string;
  readonly stage: string;
  readonly progress: number;
  readonly message?: string;
  readonly timestampMs: number;
}

export interface RustTaskResultEvent {
  readonly taskId: string;
  readonly success: boolean;
  readonly payload: unknown;
  readonly error?: string;
  readonly latencyMs: number;
}
