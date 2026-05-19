// QNBS-v3: GPU mutex service — serialises WebGPU access across webllm and onnx-webgpu consumers
//          to prevent VRAM collisions when multiple inference engines run concurrently.

export type GpuConsumer = 'webllm' | 'onnx-webgpu';
export type GpuPriority = 'high' | 'normal' | 'low';

interface QueueEntry {
  consumer: GpuConsumer;
  priority: GpuPriority;
  resolve: () => void;
}

const PRIORITY_RANK: Record<GpuPriority, number> = { high: 2, normal: 1, low: 0 };

// QNBS-v3: 30s auto-release prevents deadlock if a consumer crashes without calling releaseGpu().
const AUTO_RELEASE_MS = 30_000;

class GpuResourceManager {
  private currentConsumer: GpuConsumer | null = null;
  private queue: QueueEntry[] = [];
  private autoReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  private grantNext(): void {
    if (this.currentConsumer !== null || this.queue.length === 0) return;
    // Sort descending by priority before granting
    this.queue.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
    const next = this.queue.shift();
    if (!next) return;
    this.currentConsumer = next.consumer;
    this.startAutoRelease(next.consumer);
    next.resolve();
  }

  private startAutoRelease(consumer: GpuConsumer): void {
    if (this.autoReleaseTimer !== null) clearTimeout(this.autoReleaseTimer);
    this.autoReleaseTimer = setTimeout(() => {
      if (this.currentConsumer === consumer) {
        this.currentConsumer = null;
        this.autoReleaseTimer = null;
        this.grantNext();
      }
    }, AUTO_RELEASE_MS);
  }

  private clearAutoRelease(): void {
    if (this.autoReleaseTimer !== null) {
      clearTimeout(this.autoReleaseTimer);
      this.autoReleaseTimer = null;
    }
  }

  acquireGpu(consumer: GpuConsumer, priority: GpuPriority = 'normal'): Promise<void> {
    if (this.currentConsumer === null) {
      this.currentConsumer = consumer;
      this.startAutoRelease(consumer);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ consumer, priority, resolve });
    });
  }

  releaseGpu(consumer: GpuConsumer): void {
    if (this.currentConsumer !== consumer) return;
    this.clearAutoRelease();
    this.currentConsumer = null;
    this.grantNext();
  }

  getQueueState(): { current: GpuConsumer | null; queue: GpuConsumer[] } {
    const sorted = [...this.queue].sort(
      (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority],
    );
    return {
      current: this.currentConsumer,
      queue: sorted.map((e) => e.consumer),
    };
  }
}

// Singleton — one GPU, one manager per tab.
export const gpuResourceManager = new GpuResourceManager();
