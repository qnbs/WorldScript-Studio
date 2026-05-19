import { beforeEach, describe, expect, it } from 'vitest';
import { type PluginDescriptor, PluginRegistry } from '../../services/pluginRegistry';

function makePlugin(overrides: Partial<PluginDescriptor> = {}): PluginDescriptor {
  return {
    id: 'test-plugin',
    version: '1.0.0',
    name: 'Test Plugin',
    type: 'command',
    entrypoint: './plugins/test.ts',
    permissions: ['storage.read'],
    ...overrides,
  };
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('registers a plugin and returns it via list()', () => {
    registry.register(makePlugin());
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.id).toBe('test-plugin');
  });

  it('throws when registering a plugin with an empty id', () => {
    expect(() => registry.register(makePlugin({ id: '' }))).toThrow('non-empty id');
  });

  it('overwrites an existing plugin when re-registered with the same id', () => {
    registry.register(makePlugin({ version: '1.0.0' }));
    registry.register(makePlugin({ version: '2.0.0' }));
    expect(registry.size).toBe(1);
    expect(registry.getById('test-plugin')?.version).toBe('2.0.0');
  });

  it('unregister returns true for existing plugin and removes it', () => {
    registry.register(makePlugin());
    expect(registry.unregister('test-plugin')).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it('unregister returns false for non-existent plugin', () => {
    expect(registry.unregister('ghost')).toBe(false);
  });

  it('getById returns undefined for unknown id', () => {
    expect(registry.getById('unknown')).toBeUndefined();
  });

  it('getByType filters by type correctly', () => {
    registry.register(makePlugin({ id: 'cmd-1', type: 'command' }));
    registry.register(makePlugin({ id: 'ai-1', type: 'ai-tool' }));
    registry.register(makePlugin({ id: 'ai-2', type: 'ai-tool' }));

    const commands = registry.getByType('command');
    const aiTools = registry.getByType('ai-tool');
    const localAi = registry.getByType('local-ai-service');

    expect(commands).toHaveLength(1);
    expect(aiTools).toHaveLength(2);
    expect(localAi).toHaveLength(0);
  });

  it('size reflects the current number of registered plugins', () => {
    expect(registry.size).toBe(0);
    registry.register(makePlugin({ id: 'p1' }));
    registry.register(makePlugin({ id: 'p2' }));
    expect(registry.size).toBe(2);
  });

  it('clear removes all registered plugins', () => {
    registry.register(makePlugin({ id: 'p1' }));
    registry.register(makePlugin({ id: 'p2' }));
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.list()).toHaveLength(0);
  });

  it('supports all three PluginType values', () => {
    registry.register(makePlugin({ id: 'cmd', type: 'command' }));
    registry.register(makePlugin({ id: 'ai', type: 'ai-tool' }));
    registry.register(makePlugin({ id: 'local', type: 'local-ai-service' }));
    expect(registry.size).toBe(3);
  });
});
