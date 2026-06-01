import { describe, expect, it } from 'vitest';
import {
  RetryPolicySchema,
  RustTaskProgressEventSchema,
  RustTaskRequestSchema,
  RustTaskResultEventSchema,
  WorkerCapabilitySchema,
  WorkerMessageSchema,
} from '../src/schemas';

describe('schemas', () => {
  describe('RetryPolicySchema', () => {
    it('accepts valid retry policy', () => {
      const result = RetryPolicySchema.safeParse({
        maxRetries: 3,
        backoffMs: 500,
        maxBackoffMs: 10_000,
        jitter: true,
      });
      expect(result.success).toBe(true);
    });

    it('uses defaults for missing fields', () => {
      const result = RetryPolicySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxRetries).toBe(2);
        expect(result.data.backoffMs).toBe(400);
        expect(result.data.maxBackoffMs).toBe(30_000);
        expect(result.data.jitter).toBe(true);
      }
    });

    it('rejects negative maxRetries', () => {
      const result = RetryPolicySchema.safeParse({ maxRetries: -1 });
      expect(result.success).toBe(false);
    });

    it('rejects maxRetries above 5', () => {
      const result = RetryPolicySchema.safeParse({ maxRetries: 6 });
      expect(result.success).toBe(false);
    });
  });

  describe('WorkerCapabilitySchema', () => {
    it('accepts known capabilities', () => {
      expect(WorkerCapabilitySchema.safeParse('inference.text').success).toBe(true);
      expect(WorkerCapabilitySchema.safeParse('db.duckdb').success).toBe(true);
      expect(WorkerCapabilitySchema.safeParse('plugin.sandbox').success).toBe(true);
    });

    it('rejects unknown capabilities', () => {
      expect(WorkerCapabilitySchema.safeParse('unknown.cap').success).toBe(false);
    });
  });

  describe('WorkerMessageSchema', () => {
    it('accepts TASK message', () => {
      const result = WorkerMessageSchema.safeParse({
        kind: 'TASK',
        taskId: 't-1',
        taskType: 'ai.inference.text',
        payload: { prompt: 'hello' },
        traceId: 'trace-1',
        timeoutMs: 60_000,
      });
      expect(result.success).toBe(true);
    });

    it('accepts RESULT message with error', () => {
      const result = WorkerMessageSchema.safeParse({
        kind: 'RESULT',
        taskId: 't-1',
        success: false,
        error: { code: 'TIMEOUT', message: 'Task timed out' },
        latencyMs: 60_000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects message with missing required field', () => {
      const result = WorkerMessageSchema.safeParse({
        kind: 'TASK',
        taskId: 't-1',
      });
      expect(result.success).toBe(false);
    });

    it('rejects message with unknown kind', () => {
      const result = WorkerMessageSchema.safeParse({
        kind: 'UNKNOWN',
        taskId: 't-1',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RustTaskRequestSchema', () => {
    it('accepts valid rust task request', () => {
      const result = RustTaskRequestSchema.safeParse({
        taskId: '550e8400-e29b-41d4-a716-446655440000',
        taskType: 'export.epub',
        payload: { markdown: '# Hello' },
        priority: 'normal',
        target: 'rust',
        timeoutMs: 120_000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid UUID', () => {
      const result = RustTaskRequestSchema.safeParse({
        taskId: 'not-a-uuid',
        taskType: 'export.epub',
        payload: {},
        priority: 'normal',
        target: 'rust',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RustTaskProgressEventSchema', () => {
    it('accepts valid progress event', () => {
      const result = RustTaskProgressEventSchema.safeParse({
        taskId: 't-1',
        taskType: 'export.epub',
        stage: 'rendering',
        progress: 0.75,
        timestampMs: Date.now(),
      });
      expect(result.success).toBe(true);
    });

    it('rejects progress above 1.0', () => {
      const result = RustTaskProgressEventSchema.safeParse({
        taskId: 't-1',
        taskType: 'export.epub',
        stage: 'rendering',
        progress: 1.5,
        timestampMs: Date.now(),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RustTaskResultEventSchema', () => {
    it('accepts valid result event', () => {
      const result = RustTaskResultEventSchema.safeParse({
        taskId: 't-1',
        success: true,
        payload: { base64: 'abc' },
        latencyMs: 5000,
      });
      expect(result.success).toBe(true);
    });
  });
});
