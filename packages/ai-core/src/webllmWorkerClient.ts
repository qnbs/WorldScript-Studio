/*
 * WebLLM Worker Client - Main thread proxy for the dedicated worker (P1-1)
 */

interface WebLlmProgressReport {
  progress: number;
  text: string;
}

interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  onStreamChunk?: (chunk: string, done: boolean) => void;
  signal?: AbortSignal;
}

export interface WebLlmWorkerClient {
  init(modelId: string, options?: Record<string, unknown>): Promise<void>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  prewarm(modelId: string): Promise<void>;
  dispose(): Promise<void>;
  isReady(): boolean;
  getCurrentModel(): string | null;
}

interface PendingRequest {
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
  onStreamChunk?: (chunk: string, done: boolean) => void;
}

let workerInstance: Worker | null = null;
const pending = new Map<string, PendingRequest>();
let ready = false;
let currentModel: string | null = null;

function genId(): string {
  return `wllm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });

  workerInstance.onmessage = (e: MessageEvent) => {
    const { id, type, payload } = e.data as { id: string; type: string; payload?: any };
    const p = pending.get(id);
    if (!p) return;

    if (type === 'progress' && p.onStreamChunk) {
      // progress can be handled separately if needed
    }
    if (type === 'ready') {
      ready = true;
      currentModel = payload?.modelId ?? null;
      p.resolve();
      pending.delete(id);
    } else if (type === 'result') {
      p.resolve(payload?.text ?? '');
      pending.delete(id);
    } else if (type === 'stream-chunk') {
      if (p.onStreamChunk) p.onStreamChunk(payload?.text ?? '', !!payload?.done);
      if (payload?.done) {
        p.resolve('');
        pending.delete(id);
      }
    } else if (type === 'error') {
      p.reject(new Error(payload?.message ?? 'Worker error'));
      pending.delete(id);
    }
  };

  workerInstance.onerror = () => {
    pending.forEach((pr) => pr.reject(new Error('Worker crashed')));
    pending.clear();
    workerInstance = null;
  };

  return workerInstance;
}

export function createWebLlmWorkerClient(): WebLlmWorkerClient {
  return {
    async init(modelId: string, options: Record<string, unknown> = {}): Promise<void> {
      const w = getWorker();
      const rid = genId();
      return new Promise((res, rej) => {
        pending.set(rid, { resolve: res, reject: rej });
        w.postMessage({ id: rid, type: 'init', payload: { modelId, options } });
      });
    },
    async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
      if (!ready) throw new Error('Call init() first');
      const w = getWorker();
      const rid = genId();
      return new Promise((res, rej) => {
        const entry: PendingRequest = { resolve: res, reject: rej, onStreamChunk: options.onStreamChunk };
        pending.set(rid, entry);

        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            w.postMessage({ id: genId(), type: 'abort', payload: { requestId: rid } });
          }, { once: true });
        }

        w.postMessage({
          id: rid,
          type: 'generate',
          payload: { prompt, options: { maxTokens: options.maxTokens, temperature: options.temperature, stream: options.stream || !!options.onStreamChunk } },
        });
      });
    },
    async prewarm(modelId: string): Promise<void> {
      const w = getWorker();
      const rid = genId();
      return new Promise((res, rej) => {
        pending.set(rid, { resolve: res, reject: rej });
        w.postMessage({ id: rid, type: 'prewarm', payload: { modelId } });
      });
    },
    async dispose(): Promise<void> {
      if (!workerInstance) return;
      const w = workerInstance;
      const rid = genId();
      return new Promise((res) => {
        pending.set(rid, { resolve: () => { try { w.terminate(); } catch {} ; workerInstance = null; ready = false; currentModel = null; pending.clear(); res(); }, reject: res });
        w.postMessage({ id: rid, type: 'dispose' });
      });
    },
    isReady: () => ready,
    getCurrentModel: () => currentModel,
  };
}

let singleton: WebLlmWorkerClient | null = null;
export function getWebLlmWorkerClient(): WebLlmWorkerClient {
  if (!singleton) singleton = createWebLlmWorkerClient();
  return singleton;
}

export type { WebLlmProgressReport, WebLlmWorkerClient, GenerateOptions };
