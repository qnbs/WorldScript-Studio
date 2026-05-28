/**
 * Reference Plugin: Word Count Overlay
 *
 * Reads scene titles + current project title via the sandboxed API and logs
 * a word-count summary to the diagnostic logger. Demonstrates read-only plugin access.
 *
 * Permissions required: project.read, scene.read
 *
 * Registration example:
 *   import { pluginRegistry } from '../pluginRegistry';
 *   import { wordCountOverlayDescriptor } from './plugins/wordCountOverlay.plugin';
 *   pluginRegistry.register(wordCountOverlayDescriptor);
 *   pluginRegistry.execute('storecraft.word-count-overlay', wordCountOverlayRun, sandboxedApi);
 */

import type { PluginDescriptor, PluginSandboxedApi } from '../pluginRegistry';

export const wordCountOverlayDescriptor: PluginDescriptor = {
  id: 'storecraft.word-count-overlay',
  name: 'Word Count Overlay',
  version: '1.0.0',
  type: 'command',
  entrypoint: './wordCountOverlay.plugin.ts',
  permissions: ['project.read', 'scene.read'],
  description: 'Logs a word-count summary for the current project to the diagnostic logger.',
};

/** Plugin entry-point — called by pluginRegistry.execute() / executeAsync(). */
export async function run(api: PluginSandboxedApi): Promise<void> {
  const title = api.getProjectTitle();
  const scenes = api.getSceneTitles();
  const summary = `Project: "${title}" — ${scenes.length} scene(s): ${scenes.join(', ') || '(none)'}`;
  api.log(summary);
}
