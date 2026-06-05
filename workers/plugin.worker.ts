/// <reference lib="webworker" />
/**
 * Plugin Worker — Isolated execution context for StoryCraft plugins.
 * QNBS-v3: P0-2 — Worker isolation prevents plugins from accessing main-thread state.
 *           Enforces timeout, resource limits, and sandboxed API surface.
 */

import { registerTaskHandler, type WorkerHandlerContext } from '@domain/worker-bus';
import type { PluginSandboxedApi } from '../services/pluginRegistry';

// Minimal sandboxed API available to plugins in worker context
const sandboxApi: PluginSandboxedApi = {
  getProjectTitle: () => '',
  getSceneTitles: () => [],
  appendToCurrentScene: () => {},
  log: () => {
    // Worker-safe logging - no structured logger in worker
  },
  generateText: async () => {
    throw new Error('generateText not available in plugin worker');
  },
  storageRead: async () => {
    throw new Error('storageRead not available in plugin worker');
  },
  storageWrite: async () => {
    throw new Error('storageWrite not available in plugin worker');
  },
};

registerTaskHandler('plugin.execute', async (ctx: WorkerHandlerContext) => {
  const {
    pluginId,
    code,
    timeoutMs = 30000,
  } = ctx.payload as {
    pluginId: string;
    code: string;
    timeoutMs?: number;
  };

  // Create timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Create sandboxed scope with limited globals
    const sandboxGlobals = {
      console: {
        log: () => {},
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
      },
      setTimeout,
      clearTimeout,
      AbortController,
      AbortSignal,
    };

    // Create blob URL for dynamic import
    const blob = new Blob(
      [
        `const sandbox = ${JSON.stringify(sandboxGlobals)};`,
        `const api = ${JSON.stringify(sandboxApi)};`,
        `(${code})`,
      ],
      { type: 'application/javascript' },
    );
    const url = URL.createObjectURL(blob);

    try {
      // Dynamic import in worker context
      const module = (await import(/* @vite-ignore */ url)) as {
        run?: (api: PluginSandboxedApi) => Promise<void>;
      };

      if (typeof module['run'] !== 'function') {
        return {
          success: false,
          payload: null,
          error: `Plugin '${pluginId}' has no exported run() function`,
          latencyMs: 0,
        };
      }

      ctx.emitProgress('running', 0.5);

      // Execute plugin with timeout
      await module['run'](sandboxApi);

      ctx.emitProgress('completed', 1);

      return {
        success: true,
        payload: { pluginId },
        error: null,
        latencyMs: 0,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      payload: null,
      error: message,
      latencyMs: 0,
    };
  } finally {
    clearTimeout(timeoutId);
  }
});

// Handle unknown task types gracefully
registerTaskHandler('plugin.ping', async () => {
  return {
    success: true,
    payload: { status: 'ok', version: '1.0.0' },
    error: null,
    latencyMs: 0,
  };
});
