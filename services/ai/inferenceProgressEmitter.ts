// QNBS-v3: Pub/sub progress emitter for WebLLM model downloads — decoupled from Redux so
//          the UI can subscribe without dispatching on every 1% progress tick.
//          Adapted from CannaGuide-2025 progressEmitter.ts for WorldScript context.

export type WebLlmLoadingState = 'idle' | 'loading' | 'ready' | 'error';

export interface WebLlmLoadProgress {
  state: WebLlmLoadingState;
  progress: number; // 0–1
  text: string;
  estimatedSecondsRemaining: number | null;
}

type ProgressListener = (snapshot: WebLlmLoadProgress) => void;

const INITIAL_SNAPSHOT: WebLlmLoadProgress = {
  state: 'idle',
  progress: 0,
  text: '',
  estimatedSecondsRemaining: null,
};

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

  reportWebLlmProgress(progress: number, text: string): void {
    if (this.snapshot.state !== 'loading') {
      this.loadStartMs = Date.now();
    }
    const elapsed = this.loadStartMs != null ? (Date.now() - this.loadStartMs) / 1000 : 0;
    // Estimate remaining time from current rate (avoid division by zero)
    const estimatedSecondsRemaining =
      progress > 0.01 && progress < 1 ? Math.round((elapsed / progress) * (1 - progress)) : null;

    this.snapshot = { state: 'loading', progress, text, estimatedSecondsRemaining };
    this.emit();
  }

  reportWebLlmReady(): void {
    this.loadStartMs = null;
    this.snapshot = { state: 'ready', progress: 1, text: '', estimatedSecondsRemaining: null };
    this.emit();
  }

  reportWebLlmError(message: string): void {
    this.loadStartMs = null;
    this.snapshot = {
      state: 'error',
      progress: this.snapshot.progress,
      text: message,
      estimatedSecondsRemaining: null,
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
