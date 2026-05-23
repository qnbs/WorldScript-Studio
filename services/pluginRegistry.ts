/**
 * Plugin registry — lightweight service for discovering and managing StoryCraft Studio extensions.
 * QNBS-v3: Plugins declare a capability manifest; execute() validates permissions before dispatch.
 */

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
  /** Module path or URL to the plugin entrypoint (informational only — not auto-loaded). */
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
}

export type PluginExecuteResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Permission validation
// ---------------------------------------------------------------------------

const PERMISSION_API_MAP: Record<keyof PluginSandboxedApi, PluginPermission | null> = {
  getProjectTitle: 'project.read',
  getSceneTitles: 'scene.read',
  appendToCurrentScene: 'scene.write',
  log: null, // always allowed
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginDescriptor>();

  register(descriptor: PluginDescriptor): void {
    if (!descriptor.id) throw new Error('PluginRegistry: descriptor must have a non-empty id');
    // QNBS-v3: Re-registration overwrites silently — same as npm module re-require.
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

  /**
   * Execute a plugin by ID, passing a sandboxed API gated by its declared permissions.
   * QNBS-v3: Each api method is wrapped to check declared permissions before calling through.
   */
  execute(
    pluginId: string,
    fn: (api: PluginSandboxedApi) => void,
    rawApi: PluginSandboxedApi,
  ): PluginExecuteResult {
    const descriptor = this.plugins.get(pluginId);
    if (!descriptor) {
      return { ok: false, error: `Plugin '${pluginId}' not registered` };
    }

    const granted = new Set(descriptor.permissions);

    // Build a sandboxed proxy that enforces the declared permission set.
    const sandboxed: PluginSandboxedApi = {
      getProjectTitle: () => {
        if (!granted.has('project.read')) throw new Error('Permission denied: project.read');
        return rawApi.getProjectTitle();
      },
      getSceneTitles: () => {
        if (!granted.has('scene.read')) throw new Error('Permission denied: scene.read');
        return rawApi.getSceneTitles();
      },
      appendToCurrentScene: (text) => {
        if (!granted.has('scene.write')) throw new Error('Permission denied: scene.write');
        rawApi.appendToCurrentScene(text);
      },
      log: rawApi.log,
    };

    // Silence PERMISSION_API_MAP from dead-code elimination — it documents the mapping.
    void PERMISSION_API_MAP;

    try {
      fn(sandboxed);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Singleton registry shared across the application. */
export const pluginRegistry = new PluginRegistry();
