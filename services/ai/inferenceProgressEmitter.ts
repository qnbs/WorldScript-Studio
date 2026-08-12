// QNBS-v3: Pub/sub progress emitter for WebLLM model downloads — decoupled from Redux so
//          the UI can subscribe without dispatching on every 1% progress tick.
//          Adapted from CannaGuide-2025 progressEmitter.ts for WorldScript context.

import { WEBLLM_MODEL_APPROX_MB, type WebLlmModelId } from '@domain/ai-core';

export type WebLlmLoadingState = 'idle' | 'loading' | 'ready' | 'error';

export interface WebLlmLoadProgress {
  state: WebLlmLoadingState;
  progress: number; // 0–1
  text: string;
  estimatedSecondsRemaining: number | null;
  // QNBS-v3 (#333 item 1): DERIVED, not measured — WebLLM's own progress callback exposes only a
  // 0-1 fraction, no structured byte counts (verified against @mlc-ai/web-llm's InitProgressReport
  // type). loadedBytes/totalBytes are progress × a hand-authored known-total-size table
  // (WEBLLM_MODEL_APPROX_MB); null whenever the model id isn't in that table.
  loadedBytes: number | null;
  totalBytes: number | null;
  bytesPerSecond: number | null;
}

const INITIAL_SNAPSHOT: WebLlmLoadProgress = {
  state: 'idle',
  progress: 0,
  text: '',
  estimatedSecondsRemaining: null,
  loadedBytes: null,
  totalBytes: null,
  bytesPerSecond: null,
};

type ProgressListener = (snapshot: WebLlmLoadProgress) => void;

class InferenceProgressEmitter {
  private snapshot: WebLlmLoadProgress = { ...INITIAL_SNAPSHOT };
  private listeners: Set<ProgressListener> = new Set();
  // QNBS-v3: Track start time to compute estimated seconds remaining from current rate.
  private loadStartMs: number | null = null;

  private emit(): void {
    for (const listener of this.listeners) listener({ ...this.snapshot });
  }

  subscribeWebLlmLoading(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    // Immediately deliver current snapshot to new subscriber
    listener({ ...this.snapshot });
    return () => this.listeners.delete(listener);
  }

  getWebLlmLoadingSnapshot(): WebLlmLoadProgress {
    return { ...this.snapshot };
  }

  // QNBS-v3 (#333 item 1): modelId is optional (existing callers with no known model id keep
  // working; loadedBytes/totalBytes/bytesPerSecond simply stay null when it's absent or unknown).
  reportWebLlmProgress(progress: number, text: string, modelId?: string): void {
    if (this.snapshot.state !== 'loading') {
      this.loadStartMs = Date.now();
    }
    const elapsed = this.loadStartMs != null ? (Date.now() - this.loadStartMs) / 1000 : 0;
    // Estimate remaining time from current rate (avoid division by zero)
    const estimatedSecondsRemaining =
      progress > 0.01 && progress < 1 ? Math.round((elapsed / progress) * (1 - progress)) : null;

    const approxMb = modelId ? WEBLLM_MODEL_APPROX_MB[modelId as WebLlmModelId] : undefined;
    const totalBytes = approxMb != null ? approxMb * 1024 * 1024 : null;
    const loadedBytes = totalBytes != null ? Math.round(totalBytes * progress) : null;
    const bytesPerSecond =
      loadedBytes != null && elapsed > 0.5 ? Math.round(loadedBytes / elapsed) : null;

    this.snapshot = {
      state: 'loading',
      progress,
      text,
      estimatedSecondsRemaining,
      loadedBytes,
      totalBytes,
      bytesPerSecond,
    };
    this.emit();
  }

  reportWebLlmReady(): void {
    this.loadStartMs = null;
    this.snapshot = {
      state: 'ready',
      progress: 1,
      text: '',
      estimatedSecondsRemaining: null,
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    this.emit();
  }

  reportWebLlmError(message: string): void {
    this.loadStartMs = null;
    this.snapshot = {
      state: 'error',
      progress: this.snapshot.progress,
      text: message,
      estimatedSecondsRemaining: null,
      loadedBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
    };
    this.emit();
  }

  reset(): void {
    this.loadStartMs = null;
    this.snapshot = { ...INITIAL_SNAPSHOT };
    this.emit();
  }
}

export const inferenceProgressEmitter = new InferenceProgressEmitter();
