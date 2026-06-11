// QNBS-v3: Zod schemas for all WorkerBus v2 messages.
//          Used for runtime validation of postMessage payloads and Rust IPC.

import { z } from 'zod';

// --- Primitives -------------------------------------------------------------
export const TaskPrioritySchema = z.enum(['critical', 'high', 'normal', 'low']);
export const TaskTargetSchema = z.enum(['web', 'rust', 'any']);
export const TaskStateSchema = z.enum([
  'queued',
  'routing',
  'running',
  'cancelling',
  'completed',
  'failed',
  'dead-letter',
]);

export const WorkerCapabilitySchema = z.enum([
  'inference.text',
  'inference.embed',
  'inference.vision',
  // QNBS-v3: P1-1 — dedicated WebLLM (WebGPU) capability so heavy MLC inference runs off the
  //          main thread in its own pool, isolated from the transformers.js inference pool.
  'inference.webllm',
  'db.duckdb',
  'voice.stt',
  'voice.tts',
  'voice.vad',
  'export.epub',
  'export.pdf',
  'proforge.stage',
  'rag.search',
  'crypto.pbkdf2',
  'plugin.sandbox',
]);

// --- Retry Policy -----------------------------------------------------------
export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(5).default(2),
  backoffMs: z.number().int().positive().default(400),
  maxBackoffMs: z.number().int().positive().default(30_000),
  jitter: z.boolean().default(true),
});

// --- Worker Message Protocol (postMessage) ----------------------------------
export const WorkerMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TASK'),
    taskId: z.string().min(1),
    taskType: z.string().min(1),
    payload: z.unknown(),
    traceId: z.string().min(1),
    timeoutMs: z.number().int().positive().default(300_000),
  }),
  z.object({
    kind: z.literal('CANCEL'),
    taskId: z.string().min(1),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal('PING'),
    taskId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('PONG'),
    taskId: z.string().min(1),
    ts: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('PROGRESS'),
    taskId: z.string().min(1),
    stage: z.string().min(1),
    progress: z.number().min(0).max(1),
    message: z.string().optional(),
  }),
  z.object({
    kind: z.literal('RESULT'),
    taskId: z.string().min(1),
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .optional(),
    latencyMs: z.number().int().nonnegative().default(0),
  }),
]);

export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;

// --- Rust IPC Schemas -------------------------------------------------------
export const RustTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
  taskType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  priority: TaskPrioritySchema,
  target: TaskTargetSchema,
  timeoutMs: z.number().int().positive().default(300_000),
  retryPolicy: RetryPolicySchema.optional(),
});

export const RustTaskProgressEventSchema = z.object({
  taskId: z.string().min(1),
  taskType: z.string().min(1),
  stage: z.string().min(1),
  progress: z.number().min(0).max(1),
  message: z.string().optional(),
  timestampMs: z.number().int().positive(),
});

export const RustTaskResultEventSchema = z.object({
  taskId: z.string().min(1),
  success: z.boolean(),
  payload: z.unknown(),
  error: z.string().optional(),
  latencyMs: z.number().int().nonnegative().default(0),
});
