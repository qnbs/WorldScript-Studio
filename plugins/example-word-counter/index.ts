/**
 * Example StoryCraft Plugin — Word Counter.
 * QNBS-v3: Demonstrates scene.read + storage.read/write APIs.
 *          Install via: pluginRegistry.registerWithValidation(descriptor)
 */

import type { PluginSandboxedApi } from '../../services/pluginRegistry';

/** Plugin entry point — called by pluginRegistry.loadPlugin() / executeAsync(). */
export async function run(api: PluginSandboxedApi): Promise<void> {
  const titles = api.getSceneTitles();
  api.log(`[word-counter] Found ${titles.length} scenes`);

  // Persist scene count for later retrieval.
  await api.storageWrite('word-counter:scene-count', titles.length);
  const saved = await api.storageRead('word-counter:scene-count');
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
