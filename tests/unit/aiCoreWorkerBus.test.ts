import type { WorkerTask } from '@domain/ai-core';
import {
  detectWebGpuSupport,
  electSingleHeavyInferenceTab,
  SUPPORTED_WORKER_CHANNELS,
  WEBLLM_SUPPORTED_MODELS,
  WorkerBus,
} from '@domain/ai-core';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// WorkerBus
// ---------------------------------------------------------------------------
describe('WorkerBus', () => {
  function makeTask(priority: WorkerTask['priority'], id = 't1'): WorkerTask {
    return { id, type: 'local.text.generate', payload: {}, priority, createdAt: Date.now() };
  }

  it('enqueues and dequeues a single task', () => {
    const bus = new WorkerBus();
    bus.enqueue(makeTask('normal', 't1'));
    const task = bus.dequeue();
    expect(task?.id).toBe('t1');
  });

  it('returns undefined when queue is empty', () => {
    const bus = new WorkerBus();
    expect(bus.dequeue()).toBeUndefined();
  });

  it('dequeues in priority order: critical > high > normal > low', () => {
    const bus = new WorkerBus();
    bus.enqueue(makeTask('low', 'low'));
    bus.enqueue(makeTask('normal', 'normal'));
    bus.enqueue(makeTask('critical', 'critical'));
    bus.enqueue(makeTask('high', 'high'));
    expect(bus.dequeue()?.id).toBe('critical');
    expect(bus.dequeue()?.id).toBe('high');
    expect(bus.dequeue()?.id).toBe('normal');
    expect(bus.dequeue()?.id).toBe('low');
  });

  it('dequeues FIFO within the same priority', () => {
    const bus = new WorkerBus();
    bus.enqueue(makeTask('high', 'first'));
    bus.enqueue(makeTask('high', 'second'));
    expect(bus.dequeue()?.id).toBe('first');
    expect(bus.dequeue()?.id).toBe('second');
  });

  it('getTelemetry returns zero stats initially', () => {
    const bus = new WorkerBus();
    const t = bus.getTelemetry();
    expect(t.processedTasks).toBe(0);
    expect(t.failedTasks).toBe(0);
    expect(t.avgExecutionMs).toBe(0);
    expect(t.queueDepth).toEqual({ critical: 0, high: 0, normal: 0, low: 0 });
  });

  it('getTelemetry reflects queue depth', () => {
    const bus = new WorkerBus();
    bus.enqueue(makeTask('normal', 'n1'));
    bus.enqueue(makeTask('high', 'h1'));
    bus.enqueue(makeTask('high', 'h2'));
    const t = bus.getTelemetry();
    expect(t.queueDepth.normal).toBe(1);
    expect(t.queueDepth.high).toBe(2);
  });

  it('recordResult increments processedTasks', () => {
    const bus = new WorkerBus();
    bus.recordResult(100, true);
    bus.recordResult(200, true);
    const t = bus.getTelemetry();
    expect(t.processedTasks).toBe(2);
    expect(t.failedTasks).toBe(0);
    expect(t.avgExecutionMs).toBe(150);
  });

  it('recordResult increments failedTasks on failure', () => {
    const bus = new WorkerBus();
    bus.recordResult(100, false);
    const t = bus.getTelemetry();
    expect(t.failedTasks).toBe(1);
    expect(t.processedTasks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_WORKER_CHANNELS
// ---------------------------------------------------------------------------
describe('SUPPORTED_WORKER_CHANNELS', () => {
  it('contains generate and stream channels', () => {
    expect(SUPPORTED_WORKER_CHANNELS).toContain('local.text.generate');
    expect(SUPPORTED_WORKER_CHANNELS).toContain('local.text.stream');
  });
});

// ---------------------------------------------------------------------------
// WEBLLM_SUPPORTED_MODELS
// ---------------------------------------------------------------------------
describe('WEBLLM_SUPPORTED_MODELS', () => {
  it('contains at least one model', () => {
    expect(WEBLLM_SUPPORTED_MODELS.length).toBeGreaterThan(0);
  });

  it('each model has id and label', () => {
    WEBLLM_SUPPORTED_MODELS.forEach((m) => {
      expect(typeof m.id).toBe('string');
      expect(typeof m.label).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// detectWebGpuSupport
// ---------------------------------------------------------------------------
describe('detectWebGpuSupport', () => {
  it('returns false when navigator.gpu is absent (jsdom default)', () => {
    // jsdom does not implement WebGPU
    expect(detectWebGpuSupport()).toBe(false);
  });

  it('returns true when navigator.gpu is present (mocked)', () => {
    // QNBS-v3: jsdom does not have navigator.gpu, so define it temporarily
    const origDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true, writable: true });
    expect(detectWebGpuSupport()).toBe(true);
    if (origDescriptor) {
      Object.defineProperty(navigator, 'gpu', origDescriptor);
    } else {
      (navigator as unknown as Record<string, unknown>)['gpu'] = undefined;
    }
  });
});

// ---------------------------------------------------------------------------
// electSingleHeavyInferenceTab
// ---------------------------------------------------------------------------
describe('electSingleHeavyInferenceTab', () => {
  it('returns true when BroadcastChannel is unavailable', async () => {
    // QNBS-v3: jsdom has no BroadcastChannel → function short-circuits to true
    const result = await electSingleHeavyInferenceTab(0);
    expect(result).toBe(true);
  });
});
