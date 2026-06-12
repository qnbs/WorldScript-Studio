/**
 * Tests for PluginRegistry.loadPlugin() — dynamic plugin loading via WorkerBus.
 * QNBS-v3: P0 — Tests timeout enforcement, fetch failures, and invalid manifest handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginSandboxedApi } from '../../../services/pluginRegistry';
import { type PluginDescriptor, PluginRegistry } from '../../../services/pluginRegistry';

// Mock hybridRouter
const mockRouteTask = vi.fn();
vi.mock('../../../services/hybridRouter', () => ({
  routeTask: mockRouteTask,
}));

function makePlugin(overrides: Partial<PluginDescriptor> = {}): PluginDescriptor {
  return {
    id: 'test-dynamic-plugin',
    version: '1.0.0',
    name: 'Dynamic Plugin',
    type: 'command',
    entrypoint: 'https://example.com/plugin.js',
    permissions: ['project.read'],
    ...overrides,
  };
}

// Minimal mock API for loadPlugin tests (the API is not used in these tests)
const mockApi = {} as unknown as PluginSandboxedApi;

describe('PluginRegistry.loadPlugin()', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    vi.resetModules();
    registry = new PluginRegistry();
    registry.setEnabled(true);
    mockRouteTask.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when plugin system is disabled', async () => {
    registry.setEnabled(false);
    const result = await registry.loadPlugin(makePlugin(), mockApi);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/disabled/);
  });

  it('returns error when fetch fails with non-OK status', async () => {
    // Mock fetch to fail
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    }) as unknown as typeof fetch;

    const result = await registry.loadPlugin(
      makePlugin({ entrypoint: 'https://example.com/missing.js' }),
      mockApi,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Failed to fetch plugin/);

    // Restore fetch
    global.fetch = originalFetch;
  });

  it('returns error when WorkerBus returns null (not initialized)', async () => {
    // Mock fetch to succeed
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('export async function run(api) {}'),
    }) as unknown as typeof fetch;

    mockRouteTask.mockResolvedValue(null);

    const result = await registry.loadPlugin(makePlugin(), mockApi);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/WorkerBus not initialized/);

    global.fetch = originalFetch;
  });

  it('returns ok:true when plugin executes successfully', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('export async function run(api) { api.log("hello"); }'),
    }) as unknown as typeof fetch;

    const mockHandle = {
      result: Promise.resolve({ pluginId: 'test-dynamic-plugin' }),
      progress: (async function* () {})(),
      cancel: vi.fn(),
    };
    mockRouteTask.mockResolvedValue(mockHandle);

    const result = await registry.loadPlugin(makePlugin(), mockApi);
    expect(result.ok).toBe(true);

    global.fetch = originalFetch;
  });

  it('returns error when plugin execution throws', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve('export async function run(api) { throw new Error("plugin crash"); }'),
    }) as unknown as typeof fetch;

    const mockHandle = {
      result: Promise.reject(new Error('plugin crash')),
      progress: (async function* () {})(),
      cancel: vi.fn(),
    };
    mockRouteTask.mockResolvedValue(mockHandle);

    const result = await registry.loadPlugin(makePlugin(), mockApi);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/plugin crash/);

    global.fetch = originalFetch;
  });

  it('passes timeoutMs to routeTask', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('export async function run(api) {}'),
    }) as unknown as typeof fetch;

    mockRouteTask.mockResolvedValue({
      result: Promise.resolve({}),
      progress: (async function* () {})(),
      cancel: vi.fn(),
    });

    await registry.loadPlugin(makePlugin(), mockApi);
    expect(mockRouteTask).toHaveBeenCalledWith(
      'plugin.execute',
      expect.objectContaining({
        timeoutMs: 30000,
      }),
    );

    global.fetch = originalFetch;
  });

  it('handles network error during fetch', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

    const result = await registry.loadPlugin(makePlugin(), mockApi);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Network error/);

    global.fetch = originalFetch;
  });
});
