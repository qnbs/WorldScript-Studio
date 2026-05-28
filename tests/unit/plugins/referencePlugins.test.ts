import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '../../../services/pluginRegistry';
import {
  sceneAppenderDescriptor,
  run as sceneAppenderRun,
} from '../../../services/plugins/sceneAppender.plugin';
import {
  wordCountOverlayDescriptor,
  run as wordCountRun,
} from '../../../services/plugins/wordCountOverlay.plugin';

function makeMockApi() {
  return {
    getProjectTitle: vi.fn().mockReturnValue('Test Novel'),
    getSceneTitles: vi.fn().mockReturnValue(['Chapter 1', 'Chapter 2']),
    appendToCurrentScene: vi.fn(),
    log: vi.fn(),
    generateText: vi.fn().mockResolvedValue('generated'),
    storageRead: vi.fn().mockResolvedValue(null),
    storageWrite: vi.fn().mockResolvedValue(undefined),
  };
}

describe('wordCountOverlay plugin', () => {
  it('has a valid descriptor', () => {
    expect(wordCountOverlayDescriptor.id).toBe('storecraft.word-count-overlay');
    expect(wordCountOverlayDescriptor.permissions).toContain('project.read');
    expect(wordCountOverlayDescriptor.permissions).toContain('scene.read');
    expect(wordCountOverlayDescriptor.permissions).not.toContain('scene.write');
  });

  it('logs project title and scene count via sandboxed api', async () => {
    const api = makeMockApi();
    await wordCountRun(api);
    expect(api.getProjectTitle).toHaveBeenCalledOnce();
    expect(api.getSceneTitles).toHaveBeenCalledOnce();
    expect(api.log).toHaveBeenCalledWith(expect.stringContaining('Test Novel'));
    expect(api.log).toHaveBeenCalledWith(expect.stringContaining('2 scene'));
  });

  it('executes successfully through PluginRegistry', async () => {
    const registry = new PluginRegistry();
    const api = makeMockApi();
    registry.register(wordCountOverlayDescriptor);
    const result = await registry.executeAsync(wordCountOverlayDescriptor.id, wordCountRun, api);
    expect(result.ok).toBe(true);
    expect(api.log).toHaveBeenCalled();
  });

  it('is denied scene.write access (not in permissions)', () => {
    const registry = new PluginRegistry();
    const api = makeMockApi();
    registry.register(wordCountOverlayDescriptor);
    const result = registry.execute(
      wordCountOverlayDescriptor.id,
      (sandboxed) => sandboxed.appendToCurrentScene('evil'),
      api,
    );
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('Permission denied');
    expect(api.appendToCurrentScene).not.toHaveBeenCalled();
  });
});

describe('sceneAppender plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has a valid descriptor with write permissions', () => {
    expect(sceneAppenderDescriptor.id).toBe('storecraft.scene-appender');
    expect(sceneAppenderDescriptor.permissions).toContain('scene.write');
    expect(sceneAppenderDescriptor.permissions).toContain('storage.read');
    expect(sceneAppenderDescriptor.permissions).toContain('storage.write');
  });

  it('appends snippet and persists run count', async () => {
    const api = makeMockApi();
    api.storageRead.mockResolvedValue(null);
    await sceneAppenderRun(api);
    expect(api.appendToCurrentScene).toHaveBeenCalledWith(expect.stringContaining('Scene break'));
    expect(api.storageWrite).toHaveBeenCalledWith('storecraft.scene-appender.run-count', 1);
    expect(api.log).toHaveBeenCalledWith(expect.stringContaining('run #1'));
  });

  it('increments stored run count on subsequent calls', async () => {
    const api = makeMockApi();
    api.storageRead.mockResolvedValue(5);
    await sceneAppenderRun(api);
    expect(api.storageWrite).toHaveBeenCalledWith('storecraft.scene-appender.run-count', 6);
    expect(api.log).toHaveBeenCalledWith(expect.stringContaining('run #6'));
  });

  it('skips append when no scenes exist', async () => {
    const api = makeMockApi();
    api.getSceneTitles.mockReturnValue([]);
    await sceneAppenderRun(api);
    expect(api.appendToCurrentScene).not.toHaveBeenCalled();
    expect(api.log).toHaveBeenCalledWith(expect.stringContaining('no scenes found'));
  });
});
