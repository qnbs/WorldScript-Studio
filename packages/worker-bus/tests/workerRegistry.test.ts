import { describe, expect, it, vi } from 'vitest';
import { WorkerBus } from '../src/workerBus';
import { WorkerRegistry } from '../src/workerRegistry';

describe('WorkerRegistry', () => {
  it('registers a worker type', () => {
    const registry = new WorkerRegistry();
    registry.register({
      poolId: 'inference',
      capabilities: ['inference.text'],
      options: {
        maxWorkers: 2,
        minWorkers: 1,
        idleTimeoutMs: 60_000,
        workerScript: '/inference.worker.js',
        capabilities: ['inference.text'],
        labels: {},
      },
    });
    expect(registry.get('inference')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });

  it('installs registrations into a WorkerBus', () => {
    const registry = new WorkerRegistry();
    registry.register({
      poolId: 'inference',
      capabilities: ['inference.text'],
      options: {
        maxWorkers: 1,
        minWorkers: 1,
        idleTimeoutMs: 60_000,
        workerScript: '/inference.worker.js',
        capabilities: ['inference.text'],
        labels: {},
      },
    });

    const bus = new WorkerBus({
      maxQueueSize: 4,
      maxPreemptions: 2,
      workerPoolSize: 1,
      enableCircuitBreaker: false,
      circuitBreakerThreshold: 5,
      circuitBreakerRecoveryMs: 1_000,
      enableDeadLetter: true,
      deadLetterCapacity: 8,
      enableTracing: false,
    });

    const spy = vi.spyOn(bus, 'registerPool');
    registry.install(bus);
    expect(spy).toHaveBeenCalledWith('inference', ['inference.text'], expect.any(Object));
    bus.shutdown();
  });

  it('returns undefined for unknown poolId', () => {
    const registry = new WorkerRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });
});
