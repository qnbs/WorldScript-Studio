/**
 * Tests for services/proForge/adapters/browserProForgeCapability.ts — the browser port wiring for
 * the ProForge Capability Layer. Mocks the layer factory + IDB stores; asserts the assembled ports,
 * especially the history.load port that surfaces the in-flight run ahead of persisted history.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ProForgeCapabilityPorts,
  ProForgeProjectSnapshot,
} from '../../../services/proForge/proForgeCapabilityCore';

const { mockCreateLayer, mockLoadHistory, mockSaveHistory, mockGetMemoryBank } = vi.hoisted(() => ({
  mockCreateLayer: vi.fn((ports: unknown) => ({ ports })),
  mockLoadHistory: vi.fn(),
  mockSaveHistory: vi.fn(),
  mockGetMemoryBank: vi.fn(() => ({ search: vi.fn(), remember: vi.fn(), recall: vi.fn() })),
}));

vi.mock('../../../services/proForge/proForgeCapabilityLayer', () => ({
  createProForgeCapabilityLayer: mockCreateLayer,
}));
vi.mock('../../../services/proForge/proForgeHistoryStore', () => ({
  loadRunHistory: mockLoadHistory,
  saveRunHistory: mockSaveHistory,
}));
vi.mock('../../../services/proForge/proForgeMemoryBank', () => ({
  getMemoryBank: mockGetMemoryBank,
}));
vi.mock('../../../services/ai/inferenceGateway', () => ({
  inferenceGateway: { __gateway: true },
}));

import { createBrowserProForgeCapability } from '../../../services/proForge/adapters/browserProForgeCapability';

const run = (id: string) => ({ id, projectId: 'p1' }) as never;

function buildPorts(
  deps: Partial<Parameters<typeof createBrowserProForgeCapability>[0]> = {},
): ProForgeCapabilityPorts {
  createBrowserProForgeCapability({
    getProject: vi.fn(() => null),
    isEnabled: vi.fn(() => true),
    ...deps,
  });
  return mockCreateLayer.mock.calls.at(-1)?.[0] as ProForgeCapabilityPorts;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadHistory.mockResolvedValue([]);
});

describe('createBrowserProForgeCapability', () => {
  it('wires the InferenceGateway singleton as the gateway port', () => {
    const ports = buildPorts();
    expect(ports.gateway).toEqual({ __gateway: true });
  });

  it('delegates the project port to deps.getProject', () => {
    const snapshot = { id: 'p1', title: 'N' } as ProForgeProjectSnapshot;
    const getProject = vi.fn(() => snapshot);
    const ports = buildPorts({ getProject });
    expect(ports.project.get('p1')).toBe(snapshot);
    expect(getProject).toHaveBeenCalledWith('p1');
  });

  it('delegates isEnabled to deps', () => {
    const ports = buildPorts({ isEnabled: () => false });
    expect(ports.isEnabled()).toBe(false);
  });

  it('resolves the memory bank per project id', () => {
    const ports = buildPorts();
    ports.memory('p1');
    expect(mockGetMemoryBank).toHaveBeenCalledWith('p1');
  });

  describe('history.load', () => {
    it('returns persisted history as-is when no current run is supplied', async () => {
      mockLoadHistory.mockResolvedValueOnce([run('a'), run('b')]);
      const ports = buildPorts();
      const out = await ports.history.load('p1');
      expect(out.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('prepends the in-flight run when it is not already persisted', async () => {
      mockLoadHistory.mockResolvedValueOnce([run('a')]);
      const ports = buildPorts({ getCurrentRun: () => run('live') });
      const out = await ports.history.load('p1');
      expect(out.map((r) => r.id)).toEqual(['live', 'a']);
    });

    it('does not duplicate the current run when it is already in persisted history', async () => {
      mockLoadHistory.mockResolvedValueOnce([run('live'), run('a')]);
      const ports = buildPorts({ getCurrentRun: () => run('live') });
      const out = await ports.history.load('p1');
      expect(out.map((r) => r.id)).toEqual(['live', 'a']);
    });
  });

  it('history.save delegates to saveRunHistory', async () => {
    const ports = buildPorts();
    const runs = [run('a')];
    await ports.history.save?.('p1', runs);
    expect(mockSaveHistory).toHaveBeenCalledWith('p1', runs);
  });
});
