/**
 * Plugin registry — lightweight service for discovering and managing StoryCraft Studio extensions.
 * QNBS-v3: Plugins declare a capability manifest; execute() validates permissions before dispatch.
 *          v1: Permission gate only; Worker-scope isolation scheduled for v2 per ADR-06.
 */

import { z } from 'zod';

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
  | 'project.write'
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
  description?: string;
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
  'project.write',
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
    this.plugins.set(descriptor.id, descriptor as PluginDescriptor);
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

    // Silence PERMISSION_API_MAP from dead-code elimination — documents the mapping.
    void PERMISSION_API_MAP;

    return {
      getProjectTitle: () => {
        if (!granted.has('project.read')) deny('project.read');
        return rawApi.getProjectTitle();
      },
      getSceneTitles: () => {
        if (!granted.has('scene.read')) deny('scene.read');
        return rawApi.getSceneTitles();
      },
      appendToCurrentScene: (text) => {
        if (!granted.has('scene.write')) deny('scene.write');
        rawApi.appendToCurrentScene(text);
      },
      log: rawApi.log,
      generateText: (prompt, opts) => {
        if (!granted.has('ai.invoke')) deny('ai.invoke');
        return rawApi.generateText(prompt, opts);
      },
      storageRead: (key) => {
        if (!granted.has('storage.read')) deny('storage.read');
        return rawApi.storageRead(key);
      },
      storageWrite: (key, value) => {
        if (!granted.has('storage.write')) deny('storage.write');
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
   * QNBS-v3: v1 loads in the main thread; v2 will spawn a Worker per ADR-06.
   * The entrypoint module must export `run(api: PluginSandboxedApi): Promise<void>`.
   */
  async loadPlugin(
    descriptor: PluginDescriptor,
    rawApi: PluginSandboxedApi,
  ): Promise<PluginExecuteResult> {
    if (!this._enabled)
      return { ok: false, error: 'Plugin system is disabled (enablePluginSystem flag is off)' };
    this.register(descriptor);
    try {
      // Dynamic import — entrypoint must export a `run` function.
      const module = (await import(/* @vite-ignore */ descriptor.entrypoint)) as {
        run?: (api: PluginSandboxedApi) => Promise<void>;
      };
      if (typeof module['run'] !== 'function') {
        return { ok: false, error: `Plugin '${descriptor.id}' has no exported run() function` };
      }
      return this.executeAsync(descriptor.id, module['run'], rawApi);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Singleton registry shared across the application. */
export const pluginRegistry = new PluginRegistry();
