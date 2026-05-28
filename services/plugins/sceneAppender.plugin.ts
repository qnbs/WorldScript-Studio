/**
 * Reference Plugin: Scene Appender
 *
 * Appends a configurable text snippet to the currently-active scene.
 * Demonstrates write-capable plugin access with storage persistence.
 *
 * Permissions required: scene.read, scene.write, storage.read, storage.write
 *
 * Registration example:
 *   import { pluginRegistry } from '../pluginRegistry';
 *   import { sceneAppenderDescriptor } from './plugins/sceneAppender.plugin';
 *   pluginRegistry.register(sceneAppenderDescriptor);
 *   pluginRegistry.executeAsync('storecraft.scene-appender', run, sandboxedApi);
 */

import type { PluginDescriptor, PluginSandboxedApi } from '../pluginRegistry';

export const sceneAppenderDescriptor: PluginDescriptor = {
  id: 'storecraft.scene-appender',
  name: 'Scene Appender',
  version: '1.0.0',
  type: 'command',
  entrypoint: './sceneAppender.plugin.ts',
  permissions: ['scene.read', 'scene.write', 'storage.read', 'storage.write'],
  description: 'Appends a configurable text snippet to the active scene and tracks usage count.',
};

const STORAGE_KEY = 'storecraft.scene-appender.run-count';
const DEFAULT_SNIPPET = '\n\n---\n*[Scene break appended by Scene Appender plugin]*';

/** Plugin entry-point — called by pluginRegistry.executeAsync(). */
export async function run(api: PluginSandboxedApi): Promise<void> {
  const scenes = api.getSceneTitles();
  if (scenes.length === 0) {
    api.log('Scene Appender: no scenes found — nothing to append');
    return;
  }

  api.appendToCurrentScene(DEFAULT_SNIPPET);

  // Persist usage count across executions
  const prev = (await api.storageRead(STORAGE_KEY)) as number | null;
  const count = (prev ?? 0) + 1;
  await api.storageWrite(STORAGE_KEY, count);

  api.log(`Scene Appender: appended snippet (run #${count})`);
}
