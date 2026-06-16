/**
 * Example WorldScript Plugin — Word Counter.
 * QNBS-v3: Demonstrates scene.read + storage.read/write APIs.
 *          Install via: pluginRegistry.registerWithValidation(descriptor)
 */

import type { PluginSandboxedApi } from '../../services/pluginRegistry';

/** Plugin entry point — called by pluginRegistry.loadPlugin() / executeAsync(). */
export async function run(api: PluginSandboxedApi): Promise<void> {
  const titles = api.getSceneTitles();
  api.log(`[word-counter] Found ${titles.length} scenes`);

  // Persist scene count for later retrieval.
  // QNBS-v3: Storage keys must be namespaced to prevent cross-plugin access.
  const storageKey = `plugin:example-word-counter:scene-count`;
  await api.storageWrite(storageKey, titles.length);
  const saved = await api.storageRead(storageKey);
  api.log(`[word-counter] Stored scene count = ${String(saved)}`);
}

/** Manifest — validate and register via pluginRegistry.registerWithValidation(descriptor). */
export const descriptor = {
  id: 'example-word-counter',
  version: '1.0.0',
  name: 'Word Counter',
  type: 'command' as const,
  entrypoint: './plugins/example-word-counter/index.ts',
  permissions: ['scene.read', 'storage.read', 'storage.write'] as const,
  description: 'Lists scene titles and stores the scene count in plugin-scoped storage.',
};
