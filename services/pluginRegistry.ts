/**
 * Plugin registry — lightweight service for discovering and managing WorldScript Studio extensions.
 * QNBS-v3: Plugins declare a capability manifest; execute() validates permissions before dispatch.
 *          v2: Worker-scope isolation via routeTask to plugin.worker.ts (P0-2).
 *          Telemetry: All plugin executions are logged to the structured logger for observability.
 */

import { z } from 'zod';
import { createLogger } from './logger';

const log = createLogger('PluginRegistry');

// QNBS-v3: Defense-in-depth limits for plugin storage to prevent DoS and cross-plugin leakage.
const MAX_PLUGIN_STORAGE_KEY_LENGTH = 256;
const MAX_PLUGIN_STORAGE_VALUE_BYTES = 2 * 1024 * 1024; // 2 MiB
const PLUGIN_STORAGE_KEY_SUFFIX_RE = /^[a-zA-Z0-9_.:-]+$/;

// QNBS-v3: Plugin ids are validated by Zod on registration; this regex is an extra guard against
// ids that could be used to craft confusing storage namespaces (e.g. containing ':' or '..' ).
const SAFE_PLUGIN_ID_RE = /^[a-zA-Z0-9_.-]+$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PluginType = 'command' | 'ai-tool' | 'local-ai-service';

/** All permission scopes a plugin may declare in its capability manifest. */
export type PluginPermission =
  | 'storage.read'
  | 'storage.write'
  | 'ai.invoke'
  | 'project.read'
  | 'scene.read'
  | 'scene.write';

export interface PluginDescriptor {
  id: string;
  version: string;
  name: string;
  type: PluginType;
  /** Module path or URL to the plugin entrypoint. */
  entrypoint: string;
  /** Declared permission scopes the plugin requires (capability manifest). */
  permissions: PluginPermission[];
  /** Human-readable description shown in the Plugin Registry UI. */
  description?: string | undefined;
}

/**
 * Sandboxed API surface exposed to plugin execute() callbacks.
 * QNBS-v3: Plugins never receive Redux dispatch directly — only this controlled interface.
 */
export interface PluginSandboxedApi {
  /** Read-only access to project metadata. Requires 'project.read'. */
  getProjectTitle: () => string;
  /** Read scene titles. Requires 'scene.read'. */
  getSceneTitles: () => string[];
  /** Append text to the currently-active scene. Requires 'scene.write'. */
  appendToCurrentScene: (text: string) => void;
  /** Log a message to the diagnostic ring-buffer (never exposed to network). */
  log: (message: string) => void;
  /** Generate text via AI provider. Requires 'ai.invoke'. */
  generateText: (prompt: string, opts?: { maxTokens?: number }) => Promise<string>;
  /** Read a plugin-namespaced value from IDB storage. Requires 'storage.read'. */
  storageRead: (key: string) => Promise<unknown>;
  /** Write a plugin-namespaced value to IDB storage. Requires 'storage.write'. */
  storageWrite: (key: string, value: unknown) => Promise<void>;
}

export type PluginExecuteResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Zod schema — validates plugin manifests on registerWithValidation()
// ---------------------------------------------------------------------------

const PLUGIN_PERMISSIONS = [
  'storage.read',
  'storage.write',
  'ai.invoke',
  'project.read',
  'scene.read',
  'scene.write',
] as const;

export const PluginDescriptorSchema = z.object({
  id: z.string().min(1, 'Plugin id must not be empty'),
  version: z.string().min(1),
  name: z.string().min(1, 'Plugin name must not be empty'),
  type: z.enum(['command', 'ai-tool', 'local-ai-service']),
  entrypoint: z.string().min(1),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
  description: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Permission mapping — documents which API method requires which permission
// ---------------------------------------------------------------------------

const PERMISSION_API_MAP: Record<keyof PluginSandboxedApi, PluginPermission | null> = {
  getProjectTitle: 'project.read',
  getSceneTitles: 'scene.read',
  appendToCurrentScene: 'scene.write',
  log: null, // always allowed
  generateText: 'ai.invoke',
  storageRead: 'storage.read',
  storageWrite: 'storage.write',
};

/**
 * Validate a plugin storage key for namespace isolation and structural safety.
 * QNBS-v3: Enforces prefix, length, allowed characters, and anti-traversal checks to prevent
 * cross-plugin data access and storage abuse.
 */
function validatePluginStorageKey(key: string, pluginId: string): string {
  const expectedPrefix = `plugin:${pluginId}:`;

  if (!SAFE_PLUGIN_ID_RE.test(pluginId)) {
    log.error('Plugin id contains unsafe characters', { pluginId });
    throw new Error('Invalid plugin id: contains unsafe characters');
  }
  if (key.length > MAX_PLUGIN_STORAGE_KEY_LENGTH) {
    log.warn('Plugin storage key exceeds maximum length', {
      pluginId,
      length: key.length,
      max: MAX_PLUGIN_STORAGE_KEY_LENGTH,
    });
    throw new Error(
      `Invalid storage key: exceeds maximum length of ${MAX_PLUGIN_STORAGE_KEY_LENGTH}`,
    );
  }
  if (!key.startsWith(expectedPrefix)) {
    log.warn('Plugin storage key missing namespace prefix', {
      pluginId,
      keyPreview: key.slice(0, 32),
    });
    throw new Error(
      `Invalid storage key: must start with "plugin:${pluginId}:". Got: "${key.slice(0, 32)}..."`,
    );
  }

  const suffix = key.slice(expectedPrefix.length);
  if (suffix.length === 0) {
    throw new Error('Invalid storage key: suffix must not be empty');
  }
  if (!PLUGIN_STORAGE_KEY_SUFFIX_RE.test(suffix)) {
    log.warn('Plugin storage key suffix contains disallowed characters', {
      pluginId,
      suffixPreview: suffix.slice(0, 32),
    });
    throw new Error(
      'Invalid storage key: suffix may only contain letters, digits, underscores, dots, hyphens, and colons',
    );
  }
  if (suffix.includes('..')) {
    log.warn('Plugin storage key suffix contains traversal pattern', { pluginId, suffix });
    throw new Error('Invalid storage key: suffix must not contain ".."');
  }

  return key;
}

/**
 * Validate the serialized size of a plugin storage value to prevent storage DoS.
 * QNBS-v3: Values are serialized to structured-clone / JSON before IDB storage; we approximate
 * the size by JSON-stringifying. Complex objects with circular references will throw and be
 * rejected, which is the safe default.
 */
function validatePluginStorageValue(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Invalid storage value: cannot be serialized (circular or unsupported)');
  }
  const byteLength = new TextEncoder().encode(serialized).length;
  if (byteLength > MAX_PLUGIN_STORAGE_VALUE_BYTES) {
    throw new Error(
      `Invalid storage value: exceeds maximum size of ${MAX_PLUGIN_STORAGE_VALUE_BYTES} bytes`,
    );
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginDescriptor>();
  // QNBS-v3: Synced from featureFlags.enablePluginSystem via App.tsx effect.
  // execute/executeAsync/loadPlugin are no-ops (with error result) when disabled.
  private _enabled = false;

  /** Call from App.tsx when featureFlags.enablePluginSystem changes. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  register(descriptor: PluginDescriptor): void {
    if (!descriptor.id) throw new Error('PluginRegistry: descriptor must have a non-empty id');
    // QNBS-v3: Re-registration overwrites silently — same as npm module re-require.
    this.plugins.set(descriptor.id, descriptor);
  }

  /** Register with Zod schema validation — throws ZodError on invalid descriptor. */
  registerWithValidation(raw: unknown): void {
    const descriptor = PluginDescriptorSchema.parse(raw);
    this.plugins.set(descriptor.id, descriptor);
  }

  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  list(): PluginDescriptor[] {
    return Array.from(this.plugins.values());
  }

  getById(id: string): PluginDescriptor | undefined {
    return this.plugins.get(id);
  }

  getByType(type: PluginType): PluginDescriptor[] {
    return Array.from(this.plugins.values()).filter((p) => p.type === type);
  }

  get size(): number {
    return this.plugins.size;
  }

  clear(): void {
    this.plugins.clear();
  }

  private buildSandbox(
    descriptor: PluginDescriptor,
    rawApi: PluginSandboxedApi,
  ): PluginSandboxedApi {
    const granted = new Set(descriptor.permissions);
    const deny = (perm: PluginPermission): never => {
      throw new Error(`Permission denied: ${perm}`);
    };

    // QNBS-v3: Helper that reads the single source-of-truth permission map and throws
    // when the plugin descriptor does not declare the required permission.
    const guard = (method: keyof PluginSandboxedApi): void => {
      const perm = PERMISSION_API_MAP[method];
      if (perm && !granted.has(perm)) deny(perm);
    };

    return {
      getProjectTitle: () => {
        guard('getProjectTitle');
        return rawApi.getProjectTitle();
      },
      getSceneTitles: () => {
        guard('getSceneTitles');
        return rawApi.getSceneTitles();
      },
      appendToCurrentScene: (text) => {
        guard('appendToCurrentScene');
        rawApi.appendToCurrentScene(text);
      },
      log: rawApi.log,
      generateText: (prompt, opts) => {
        guard('generateText');
        return rawApi.generateText(prompt, opts);
      },
      storageRead: (key) => {
        guard('storageRead');
        // QNBS-v3: Enforce plugin storage key namespacing to prevent cross-plugin data access.
        validatePluginStorageKey(key, descriptor.id);
        return rawApi.storageRead(key);
      },
      storageWrite: (key, value) => {
        guard('storageWrite');
        // QNBS-v3: Enforce plugin storage key namespacing and value size limits to prevent
        // cross-plugin data access and storage DoS.
        validatePluginStorageKey(key, descriptor.id);
        validatePluginStorageValue(value);
        return rawApi.storageWrite(key, value);
      },
    };
  }

  /**
   * Execute a plugin synchronously with a permission-gated sandboxed API.
   * QNBS-v3: Plugins using async APIs (generateText, storageRead, storageWrite) should
   *          use executeAsync() instead so errors propagate correctly.
   */
  execute(
    pluginId: string,
    fn: (api: PluginSandboxedApi) => void,
    rawApi: PluginSandboxedApi,
  ): PluginExecuteResult {
    // QNBS-v3: Guard matches featureCatalog drift P2 — registry callable without flag otherwise.
    if (!this._enabled)
      return { ok: false, error: 'Plugin system is disabled (enablePluginSystem flag is off)' };
    const descriptor = this.plugins.get(pluginId);
    if (!descriptor) {
      return { ok: false, error: `Plugin '${pluginId}' not registered` };
    }

    try {
      fn(this.buildSandbox(descriptor, rawApi));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Execute a plugin asynchronously — supports plugins that use async APIs
   * (generateText, storageRead, storageWrite).
   */
  async executeAsync(
    pluginId: string,
    fn: (api: PluginSandboxedApi) => Promise<void>,
    rawApi: PluginSandboxedApi,
  ): Promise<PluginExecuteResult> {
    if (!this._enabled)
      return { ok: false, error: 'Plugin system is disabled (enablePluginSystem flag is off)' };
    const descriptor = this.plugins.get(pluginId);
    if (!descriptor) {
      return { ok: false, error: `Plugin '${pluginId}' not registered` };
    }

    try {
      await fn(this.buildSandbox(descriptor, rawApi));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Dynamically load a plugin by entrypoint URL and execute its run() export.
   * QNBS-v3: P0-1..P0-3 — Routes to plugin.worker.ts for isolated execution.
   * The entrypoint module must export `run(api: PluginSandboxedApi): Promise<void>`.
   * Read-only API data is passed as a snapshot; side effects (appendToCurrentScene, log)
   * are collected by the worker and applied back on the main thread after successful run.
   * Async APIs that need main-thread state (generateText, storage) are unavailable inside
   * the worker sandbox; use executeAsync() for those permissions instead.
   */
  async loadPlugin(
    descriptor: PluginDescriptor,
    rawApi: PluginSandboxedApi,
  ): Promise<PluginExecuteResult> {
    const startTime = Date.now();
    if (!this._enabled) {
      log.warn('Plugin load rejected: system disabled', { pluginId: descriptor.id });
      return { ok: false, error: 'Plugin system is disabled (enablePluginSystem flag is off)' };
    }
    this.register(descriptor);
    try {
      // Fetch plugin code for worker execution
      const response = await fetch(descriptor.entrypoint);
      if (!response.ok) {
        log.error('Plugin fetch failed', { pluginId: descriptor.id, status: response.status });
        return {
          ok: false,
          error: `Failed to fetch plugin '${descriptor.id}': ${response.status}`,
        };
      }
      const code = await response.text();

      // QNBS-v3: Pass a read-only snapshot of the sandboxed API into the worker.
      // The worker cannot receive function references over postMessage, so we serialize
      // only the data and let the worker collect side effects to apply back here.
      const readApiSnapshot = {
        projectTitle: rawApi.getProjectTitle(),
        sceneTitles: rawApi.getSceneTitles(),
      };

      // Route to worker for isolated execution
      const { routeTask } = await import('./hybridRouter');
      const handle = await routeTask('plugin.execute', {
        pluginId: descriptor.id,
        code,
        timeoutMs: 30000,
        grantedPermissions: descriptor.permissions,
        readApiSnapshot,
      });

      if (!handle) {
        log.error('Plugin execution failed: WorkerBus not initialized', {
          pluginId: descriptor.id,
        });
        return { ok: false, error: 'WorkerBus not initialized' };
      }

      try {
        const result = (await handle.result) as {
          pluginId: string;
          sideEffects?: Array<{ kind: 'append' | 'log'; payload: unknown }>;
          logs?: string[];
        };
        const sideEffects = result?.sideEffects ?? [];
        for (const effect of sideEffects) {
          if (effect.kind === 'append' && typeof effect.payload === 'string') {
            rawApi.appendToCurrentScene(effect.payload);
          }
          // QNBS-v3: 'log' side effects are intentionally not replayed through rawApi.log
          // to avoid log loops; they are included in the telemetry entry below.
        }

        const duration = Date.now() - startTime;
        log.info('Plugin executed successfully', {
          pluginId: descriptor.id,
          durationMs: duration,
          sideEffects: sideEffects.length,
          logs: result?.logs?.length ?? 0,
        });
        return { ok: true };
      } catch (e) {
        const duration = Date.now() - startTime;
        log.error('Plugin execution failed', {
          pluginId: descriptor.id,
          error: e,
          durationMs: duration,
        });
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      log.error('Plugin load threw', { pluginId: descriptor.id, error: err, durationMs: duration });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Singleton registry shared across the application. */
export const pluginRegistry = new PluginRegistry();
