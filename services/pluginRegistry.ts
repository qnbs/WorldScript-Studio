/**
 * Plugin registry — lightweight service for discovering and managing StoryCraft Studio extensions.
 * QNBS-v3: Plugins are metadata descriptors only; no dynamic code execution from untrusted sources.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PluginType = 'command' | 'ai-tool' | 'local-ai-service';

export interface PluginDescriptor {
  id: string;
  version: string;
  name: string;
  type: PluginType;
  /** Module path or URL to the plugin entrypoint (informational only — not auto-loaded). */
  entrypoint: string;
  /** Declared permission scopes the plugin requires (e.g. 'storage.read', 'ai.invoke'). */
  permissions: string[];
  /** Human-readable description shown in the Plugin Registry UI. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginDescriptor>();

  register(descriptor: PluginDescriptor): void {
    if (!descriptor.id) throw new Error('PluginRegistry: descriptor must have a non-empty id');
    if (this.plugins.has(descriptor.id)) {
      // QNBS-v3: Re-registration overwrites silently — same as npm module re-require.
    }
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
}

/** Singleton registry shared across the application. */
export const pluginRegistry = new PluginRegistry();
