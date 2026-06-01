// QNBS-v3: WorkerBus v2 — central orchestration layer for all background tasks.
//          Replaces the ad-hoc WorkerBus in packages/ai-core with a real worker pool,
//          typed message protocol, circuit breakers, dead-letter queue, and hybrid routing.

export { createCancellationToken } from './cancellation';
export { CircuitBreaker } from './circuitBreaker';
// QNBS-v3: WorkerBus v2 runtime exports
export {
  CIRCUIT_BREAKER_RECOVERY_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_WINDOW_MS,
  DEAD_LETTER_CAPACITY,
  DEFAULT_TIMEOUT_MS,
  MAX_PREEMPTIONS,
  MAX_QUEUE_SIZE,
  MAX_WORKERS_INFERENCE,
  MIN_WORKERS,
  PROTOCOL_VERSION,
  WORKER_IDLE_TIMEOUT_MS,
  WORKER_PING_INTERVAL_MS,
  WORKER_PONG_TIMEOUT_MS,
} from './constants';
export { DeadLetterQueue } from './deadLetterQueue';
export {
  createCancelMessage,
  createPingMessage,
  createPongMessage,
  createProgressMessage,
  createResultMessage,
  createTaskMessage,
  isCancelMessage,
  isPingMessage,
  isPongMessage,
  isProgressMessage,
  isResultMessage,
  isTaskMessage,
  postMessageFromWorker,
  postMessageTyped,
  validateWorkerMessage,
} from './messageBus';
export { ProgressEmitter } from './progressEmitter';
export { ProtocolHandler, type ProtocolHandlerOptions } from './protocolHandler';
export {
  RetryPolicySchema,
  RustTaskProgressEventSchema,
  RustTaskRequestSchema,
  RustTaskResultEventSchema,
  TaskPrioritySchema,
  TaskStateSchema,
  TaskTargetSchema,
  WorkerCapabilitySchema,
  type WorkerMessage,
  WorkerMessageSchema,
} from './schemas';
export { PriorityTaskQueue } from './taskQueue';
export type {
  CancellationToken,
  CircuitBreakerState,
  EnqueueOptions,
  PooledWorker,
  RetryPolicy,
  RustTaskProgressEvent,
  RustTaskRequest,
  RustTaskResultEvent,
  TaskErrorInfo,
  TaskHandler,
  TaskPriority,
  TaskProgress,
  TaskQueueEntry,
  TaskResult,
  TaskState,
  TaskTarget,
  WorkerBusOptions,
  WorkerBusTelemetry,
  WorkerCapability,
  WorkerPoolOptions,
  WorkerTask,
} from './types';
export {
  DEFAULT_RETRY_POLICY,
  PRIORITY_ORDER,
  TaskError,
} from './types';
export {
  deregisterTaskHandler,
  registerTaskHandler,
  type WorkerHandlerContext,
  type WorkerTaskHandler,
} from './workerBootstrap';
export { WorkerBus } from './workerBus';
export { type PooledWorkerInstance, WorkerPool } from './workerPool';
export { WorkerRegistry } from './workerRegistry';
