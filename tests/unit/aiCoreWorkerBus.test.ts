import type { WorkerTask } from '@domain/ai-core';
import {
  detectWebGpuSupport,
  electSingleHeavyInferenceTab,
  SUPPORTED_WORKER_CHANNELS,
  WEBLLM_SUPPORTED_MODELS,
  WorkerBus,
} from '@domain/ai-core';
import { describe, expect, it, vi } from 'vitest';

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

  // QNBS-v3: v2 WorkerBus — backpressure, cancel, abort, preemption-promotion, extended telemetry
  it('isBackpressured returns false for critical regardless of queue size', () => {
    const bus = new WorkerBus();
    // Fill queue to MAX_QUEUE_SIZE (32) with normal tasks
    for (let i = 0; i < 32; i++) {
      bus.enqueue(makeTask('normal', `n${i}`));
    }
    expect(bus.isBackpressured('critical')).toBe(false);
    expect(bus.isBackpressured('high')).toBe(true);
    expect(bus.isBackpressured('normal')).toBe(true);
    expect(bus.isBackpressured('low')).toBe(true);
  });

  it('enqueue returns false when queue is backpressured (non-critical)', () => {
    const bus = new WorkerBus();
    for (let i = 0; i < 32; i++) {
      bus.enqueue(makeTask('normal', `n${i}`));
    }
    const rejected = bus.enqueue(makeTask('high', 'rejected'));
    expect(rejected).toBe(false);
    // Critical still gets through
    const accepted = bus.enqueue(makeTask('critical', 'critical-bypass'));
    expect(accepted).toBe(true);
  });

  it('cancel removes a queued task', () => {
    const bus = new WorkerBus();
    bus.enqueue(makeTask('normal', 'target'));
    bus.enqueue(makeTask('normal', 'other'));
    const removed = bus.cancel('target');
    expect(removed).toBe(true);
    // Only 'other' remains
    expect(bus.dequeue()?.id).toBe('other');
    expect(bus.dequeue()).toBeUndefined();
  });

  it('cancel returns false for unknown taskId', () => {
    const bus = new WorkerBus();
    expect(bus.cancel('nonexistent')).toBe(false);
  });

  it('registerTask returns an AbortSignal; cancel aborts in-flight task', () => {
    const bus = new WorkerBus();
    const signal = bus.registerTask('inflight-1');
    expect(signal.aborted).toBe(false);
    bus.cancel('inflight-1');
    expect(signal.aborted).toBe(true);
  });

  it('getTelemetry includes peakLatencyMs, errorRate, lastSuccessAt', () => {
    const bus = new WorkerBus();
    expect(bus.getTelemetry().peakLatencyMs).toBe(0);
    expect(bus.getTelemetry().errorRate).toBe(0);
    expect(bus.getTelemetry().lastSuccessAt).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    bus.recordResult(500, true);
    bus.recordResult(200, false);
    const t = bus.getTelemetry();
    expect(t.peakLatencyMs).toBe(500);
    expect(t.errorRate).toBeCloseTo(0.5);
    expect(t.lastSuccessAt).toBe(1_000_000);
    vi.useRealTimers();
  });

  it('low-priority task re-queued MAX_PREEMPTIONS times gets promoted to normal', () => {
    const bus = new WorkerBus();
    // Enqueue a low task that has been re-queued 3 times (= MAX_PREEMPTIONS)
    bus.enqueue({ ...makeTask('low', 'promoted'), requeueCount: 3 });
    // Dequeue should give us 'promoted' with normal priority (promoted)
    const dequeued = bus.dequeue();
    expect(dequeued?.id).toBe('promoted');
    expect(dequeued?.priority).toBe('normal');
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
