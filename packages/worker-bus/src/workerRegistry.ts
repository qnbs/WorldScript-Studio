// QNBS-v3: Declarative registry for worker types. Maps capabilities → pool configuration.

import type { WorkerCapability, WorkerPoolOptions } from './types';
import type { WorkerBus } from './workerBus';

export interface WorkerTypeRegistration {
  readonly poolId: string;
  readonly capabilities: readonly WorkerCapability[];
  readonly options: WorkerPoolOptions;
}

export class WorkerRegistry {
  private readonly types: Map<string, WorkerTypeRegistration> = new Map();

  register(def: WorkerTypeRegistration): void {
    this.types.set(def.poolId, def);
  }

  install(bus: WorkerBus): void {
    for (const def of this.types.values()) {
      bus.registerPool(def.poolId, def.capabilities, def.options);
    }
  }

  get(poolId: string): WorkerTypeRegistration | undefined {
    return this.types.get(poolId);
  }

  list(): readonly WorkerTypeRegistration[] {
    return Array.from(this.types.values());
  }
}
