import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PluginDescriptor,
  PluginDescriptorSchema,
  PluginRegistry,
  type PluginSandboxedApi,
} from '../../services/pluginRegistry';

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

function makeApi(overrides: Partial<PluginSandboxedApi> = {}): PluginSandboxedApi {
  return {
    getProjectTitle: vi.fn(() => 'Test Project'),
    getSceneTitles: vi.fn(() => ['Scene 1', 'Scene 2']),
    appendToCurrentScene: vi.fn(),
    log: vi.fn(),
    generateText: vi.fn().mockResolvedValue('Generated text'),
    storageRead: vi.fn().mockResolvedValue(null),
    storageWrite: vi.fn().mockResolvedValue(undefined),
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

describe('PluginRegistry.execute()', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('returns error for unregistered plugin', () => {
    const result = registry.execute('ghost', () => {}, makeApi());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not registered/);
  });

  it('calls fn and returns ok:true for registered plugin', () => {
    registry.register(makePlugin({ permissions: ['project.read'] }));
    const fn = vi.fn();
    const result = registry.execute('test-plugin', fn, makeApi());
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('allows log() without any permission', () => {
    registry.register(makePlugin({ permissions: [] }));
    const api = makeApi();
    registry.execute('test-plugin', (sandboxed) => sandboxed.log('hello'), api);
    expect(api.log).toHaveBeenCalledWith('hello');
  });

  it('denies getProjectTitle when project.read is not declared', () => {
    registry.register(makePlugin({ permissions: [] }));
    const result = registry.execute(
      'test-plugin',
      (sandboxed) => sandboxed.getProjectTitle(),
      makeApi(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/project\.read/);
  });

  it('allows getProjectTitle when project.read is declared', () => {
    registry.register(makePlugin({ permissions: ['project.read'] }));
    const api = makeApi();
    const result = registry.execute('test-plugin', (sandboxed) => sandboxed.getProjectTitle(), api);
    expect(result.ok).toBe(true);
    expect(api.getProjectTitle).toHaveBeenCalledOnce();
  });

  it('denies appendToCurrentScene without scene.write', () => {
    registry.register(makePlugin({ permissions: ['scene.read'] }));
    const result = registry.execute(
      'test-plugin',
      (sandboxed) => sandboxed.appendToCurrentScene('text'),
      makeApi(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/scene\.write/);
  });

  it('returns ok:false and error message when fn throws', () => {
    registry.register(makePlugin({ permissions: [] }));
    const result = registry.execute(
      'test-plugin',
      () => {
        throw new Error('plugin crash');
      },
      makeApi(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('plugin crash');
  });
});

describe('PluginRegistry.executeAsync()', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('returns error for unregistered plugin', async () => {
    const result = await registry.executeAsync('ghost', async () => {}, makeApi());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not registered/);
  });

  it('allows generateText when ai.invoke is declared', async () => {
    registry.register(makePlugin({ permissions: ['ai.invoke'] }));
    const api = makeApi();
    const result = await registry.executeAsync(
      'test-plugin',
      async (sandboxed) => {
        await sandboxed.generateText('Write a scene', { maxTokens: 100 });
      },
      api,
    );
    expect(result.ok).toBe(true);
    expect(api.generateText).toHaveBeenCalledWith('Write a scene', { maxTokens: 100 });
  });

  it('denies generateText without ai.invoke', async () => {
    registry.register(makePlugin({ permissions: [] }));
    const result = await registry.executeAsync(
      'test-plugin',
      async (sandboxed) => {
        await sandboxed.generateText('prompt');
      },
      makeApi(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ai\.invoke/);
  });

  it('allows storageRead when storage.read is declared', async () => {
    registry.register(makePlugin({ permissions: ['storage.read'] }));
    const api = makeApi({ storageRead: vi.fn().mockResolvedValue(42) });
    let value: unknown;
    await registry.executeAsync(
      'test-plugin',
      async (sandboxed) => {
        value = await sandboxed.storageRead('my-key');
      },
      api,
    );
    expect(api.storageRead).toHaveBeenCalledWith('my-key');
    expect(value).toBe(42);
  });

  it('denies storageRead without storage.read', async () => {
    registry.register(makePlugin({ permissions: [] }));
    const result = await registry.executeAsync(
      'test-plugin',
      async (sandboxed) => {
        await sandboxed.storageRead('key');
      },
      makeApi(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/storage\.read/);
  });

  it('allows storageWrite when storage.write is declared', async () => {
    registry.register(makePlugin({ permissions: ['storage.write'] }));
    const api = makeApi();
    await registry.executeAsync(
      'test-plugin',
      async (sandboxed) => {
        await sandboxed.storageWrite('scene-count', 5);
      },
      api,
    );
    expect(api.storageWrite).toHaveBeenCalledWith('scene-count', 5);
  });

  it('denies storageWrite without storage.write', async () => {
    registry.register(makePlugin({ permissions: ['storage.read'] }));
    const result = await registry.executeAsync(
      'test-plugin',
      async (sandboxed) => {
        await sandboxed.storageWrite('key', 'value');
      },
      makeApi(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/storage\.write/);
  });

  it('returns ok:false when async fn rejects', async () => {
    registry.register(makePlugin({ permissions: [] }));
    const result = await registry.executeAsync(
      'test-plugin',
      async () => {
        throw new Error('async crash');
      },
      makeApi(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('async crash');
  });
});

describe('PluginDescriptorSchema (Zod validation)', () => {
  it('accepts a valid descriptor', () => {
    const raw = {
      id: 'valid-plugin',
      version: '1.0.0',
      name: 'Valid Plugin',
      type: 'command',
      entrypoint: './plugins/valid.ts',
      permissions: ['storage.read', 'ai.invoke'],
    };
    expect(() => PluginDescriptorSchema.parse(raw)).not.toThrow();
  });

  it('rejects a descriptor with an empty id', () => {
    const raw = {
      id: '',
      version: '1.0.0',
      name: 'Bad Plugin',
      type: 'command',
      entrypoint: './plugins/bad.ts',
      permissions: [],
    };
    expect(() => PluginDescriptorSchema.parse(raw)).toThrow();
  });

  it('rejects a descriptor with an invalid permission', () => {
    const raw = {
      id: 'plugin-x',
      version: '1.0.0',
      name: 'Plugin X',
      type: 'command',
      entrypoint: './plugins/x.ts',
      permissions: ['network.unrestricted'],
    };
    expect(() => PluginDescriptorSchema.parse(raw)).toThrow();
  });

  it('registerWithValidation throws on invalid descriptor', () => {
    const registry = new PluginRegistry();
    expect(() => registry.registerWithValidation({ id: '', name: 'bad' })).toThrow();
  });

  it('registerWithValidation registers a valid descriptor', () => {
    const registry = new PluginRegistry();
    registry.registerWithValidation({
      id: 'validated-plugin',
      version: '1.0.0',
      name: 'Validated Plugin',
      type: 'command',
      entrypoint: './plugins/validated.ts',
      permissions: ['project.read'],
    });
    expect(registry.getById('validated-plugin')).toBeDefined();
  });
});
