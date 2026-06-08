/*
 * WebLLM Worker Client (Main Thread Proxy)
 *
 * Provides a clean async API that mirrors the previous direct webllmOptimizer usage
 * but routes all heavy work (model init + inference) to the dedicated Web Worker.
 *
 * Usage example:
 *   import { createWebLlmWorkerClient } from '@domain/ai-core';
 *   const client = createWebLlmWorkerClient();
 *   await client.init('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
 *   const result = await client.generate('Write a short story...');
 *   client.dispose();
 *
 * Benefits:
 * - Main thread remains responsive during model loading and long generations.
 * - WebGPU context is fully isolated in the worker.
 * - Easy to integrate with existing WorkerBus / gpuResourceManager.
 */

/// <reference types="vite/client" /> // for import.meta.url in Vite

import type { WebLlmProgressReport } from './index'; // or define locally

interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  onStreamChunk?: (chunk: string, done: boolean) => void;
  signal?: AbortSignal;
}

interface WebLlmWorkerClient {
  init(modelId: string, options?: any): Promise<void>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  prewarm(modelId: string): Promise<void>;
  dispose(): Promise<void>;
  isReady(): boolean;
  getCurrentModel(): string | null;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  onProgress?: (report: WebLlmProgressReport) => void;
  onStreamChunk?: (chunk: string, done: boolean) => void;
}

let worker: Worker | null = null;
let pendingRequests = new Map<string, PendingRequest>();
let currentModelId: string | null = null;
let isInitialized = false;

// Generate unique request IDs
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function ensureWorker(): Worker {
  if (worker) return worker;

  // Vite-friendly worker creation (bundles correctly as ESM worker)
  worker = new Worker(
    new URL('./webllm.worker.ts', import.meta.url),
    { type: 'module' }
  );

  worker.onmessage = (event: MessageEvent) => {
    const { id, type, payload } = event.data as {
      id: string;
      type: string;
      payload?: any;
    };

    const pending = pendingRequests.get(id);
    if (!pending) {
      // Progress or unsolicited messages
      if (type === 'progress' && pendingRequests.size > 0) {
        // Broadcast progress to the most recent init request if needed
        // For simplicity, we assume progress is tied to init/generate id
      }
      return;
    }

    switch (type) {
      case 'progress':
        if (pending.onProgress) {
          pending.onProgress(payload as WebLlmProgressReport);
        }
        break;

      case 'ready':
        isInitialized = true;
        currentModelId = payload?.modelId || null;
        pending.resolve(undefined);
        pendingRequests.delete(id);
        break;

      case 'result':
        pending.resolve(payload?.text || '');
        pendingRequests.delete(id);
        break;

      case 'stream-chunk':
        if (pending.onStreamChunk && payload) {
          pending.onStreamChunk(payload.text || '', !!payload.done);
        }
        if (payload?.done) {
          pending.resolve(''); // final resolve after stream ends
          pendingRequests.delete(id);
        }
        break;

      case 'error':
        pending.reject(new Error(payload?.message || 'WebLLM Worker error'));
        pendingRequests.delete(id);
        break;

      default:
        pending.reject(new Error(`Unknown worker response type: ${type}`));
        pendingRequests.delete(id);
    }
  };

  worker.onerror = (err) => {
    console.error('[webllmWorkerClient] Worker error:', err);
    // Reject all pending on fatal worker error
    pendingRequests.forEach((p) => p.reject(new Error('WebLLM worker crashed')));
    pendingRequests.clear();
    // Optional: auto-recreate worker on next use
    worker = null;
  };

  return worker;
}

/**
 * Create and return a WebLLM Worker Client instance.
 * Call this from services that need isolated WebLLM inference.
 */
export function createWebLlmWorkerClient(): WebLlmWorkerClient {
  const clientId = generateRequestId(); // for potential multi-client tracking

  return {
    async init(modelId: string, options: any = {}): Promise<void> {
      const w = ensureWorker();
      const requestId = generateRequestId();

      return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });

        w.postMessage({
          id: requestId,
          type: 'init',
          payload: { modelId, options },
        });
      });
    },

    async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
      if (!isInitialized || !currentModelId) {
        throw new Error('WebLLM Worker not initialized. Call init() first.');
      }

      const w = ensureWorker();
      const requestId = generateRequestId();

      return new Promise((resolve, reject) => {
        const pending: PendingRequest = {
          resolve,
          reject,
          onStreamChunk: options.onStreamChunk,
        };
        pendingRequests.set(requestId, pending);

        // Forward AbortSignal if provided
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            w.postMessage({
              id: generateRequestId(),
              type: 'abort',
              payload: { requestId },
            });
          }, { once: true });
        }

        w.postMessage({
          id: requestId,
          type: 'generate',
          payload: {
            prompt,
            options: {
              maxTokens: options.maxTokens,
              temperature: options.temperature,
              stream: !!options.stream || !!options.onStreamChunk,
            },
          },
        });
      });
    },

    async prewarm(modelId: string): Promise<void> {
      const w = ensureWorker();
      const requestId = generateRequestId();

      return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
        w.postMessage({ id: requestId, type: 'prewarm', payload: { modelId } });
      });
    },

    async dispose(): Promise<void> {
      if (!worker) return Promise.resolve();

      const w = worker;
      const requestId = generateRequestId();

      return new Promise((resolve) => {
        // We resolve even on error to allow cleanup
        pendingRequests.set(requestId, {
          resolve: () => {
            // Terminate worker after dispose
            try { w.terminate(); } catch {}
            worker = null;
            isInitialized = false;
            currentModelId = null;
            pendingRequests.clear();
            resolve(undefined);
          },
          reject: () => resolve(undefined),
        });

        w.postMessage({ id: requestId, type: 'dispose' });
      });
    },

    isReady(): boolean {
      return isInitialized;
    },

    getCurrentModel(): string | null {
      return currentModelId;
    },
  };
}

// Optional singleton for simple use cases (most services can use their own instance)
let singletonClient: WebLlmWorkerClient | null = null;

export function getWebLlmWorkerClient(): WebLlmWorkerClient {
  if (!singletonClient) {
    singletonClient = createWebLlmWorkerClient();
  }
  return singletonClient;
}
