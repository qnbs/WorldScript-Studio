/**
 * Tests for services/cloudSync/cloudSyncBackend.ts
 * QNBS-v3: Mocks CloudSyncClient and cloudSyncEncryption; tests save/load/delete delegates
 * and verifies that API keys / images / snapshots are blocked (security).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPut = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn().mockResolvedValue(null);
const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockList = vi.fn().mockResolvedValue([]);

vi.mock('../../services/cloudSync/cloudSyncClient', () => ({
  CloudSyncClient: vi.fn().mockImplementation(() => ({
    put: mockPut,
    get: mockGet,
    delete: mockDelete,
    list: mockList,
  })),
}));

// enc/dec: just JSON.stringify / JSON.parse for tests
vi.mock('../../services/cloudSync/cloudSyncEncryption', () => ({
  encryptCloudPayload: vi
    .fn()
    .mockImplementation((_key: unknown, data: unknown) => Promise.resolve(JSON.stringify(data))),
  decryptCloudPayload: vi
    .fn()
    .mockImplementation((_key: unknown, blob: string) => Promise.resolve(JSON.parse(blob))),
  deriveCloudSyncKey: vi.fn().mockResolvedValue({} as CryptoKey),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { CloudSyncBackend } from '../../services/cloudSync/cloudSyncBackend';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const FAKE_KEY = {} as CryptoKey;
const FAKE_CLIENT = {
  put: mockPut,
  get: mockGet,
  delete: mockDelete,
  list: mockList,
};

function makeBackend(): CloudSyncBackend {
  // biome-ignore lint/suspicious/noExplicitAny: test construction bypasses factory
  return new (CloudSyncBackend as any)(FAKE_CLIENT, FAKE_KEY);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// QNBS-v3: Explicit-consent gate tests — guard throws before any service calls.
// enableCloudSync flag was retired in v1.20; the boolean consent param replaces it.
describe('CloudSyncBackend.create() explicit-consent gate', () => {
  it('throws when explicitConsent is false (default, no arg)', async () => {
    await expect(
      CloudSyncBackend.create({ endpoint: 'https://sync.example.com', token: 't' }, 'pass', 'u'),
    ).rejects.toThrow(/explicit user consent required/);
  });

  it('throws when explicitConsent is explicitly false', async () => {
    await expect(
      CloudSyncBackend.create(
        { endpoint: 'https://sync.example.com', token: 't' },
        'pass',
        'u',
        false,
      ),
    ).rejects.toThrow(/explicit user consent required/);
  });
});

describe('CloudSyncBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);
    mockList.mockResolvedValue([]);
  });

  // --- saveProject / loadProject ---

  it('saveProject calls put with project key', async () => {
    const backend = makeBackend();
    await backend.saveProject({
      present: {
        data: { id: 'proj-abc', title: 'Test', sections: [] } as unknown as ReturnType<
          typeof Object
        >,
      },
    } as Parameters<typeof backend.saveProject>[0]);
    expect(mockPut).toHaveBeenCalledWith(expect.stringContaining('project/'), expect.any(String));
  });

  it('loadProject returns null when not found', async () => {
    mockGet.mockResolvedValueOnce(null);
    const backend = makeBackend();
    const result = await backend.loadProject('proj-abc');
    expect(result).toBeNull();
  });

  it('loadProject decrypts and returns data (LWW-wrapped payload)', async () => {
    // QNBS-v3: P2-1 — stored format is CloudSyncPayload<T> since LWW was added
    mockGet.mockResolvedValueOnce(
      JSON.stringify({
        data: { id: 'proj-abc', title: 'Story' },
        meta: { lastModified: 1000, deviceId: 'test-device', version: 1 },
      }),
    );
    const backend = makeBackend();
    const result = await backend.loadProject('proj-abc');
    expect(result?.title).toBe('Story');
  });

  it('listProjects strips the project/ prefix', async () => {
    mockList.mockResolvedValueOnce([
      { key: 'project/abc', size: 1, lastModified: '' },
      { key: 'project/xyz', size: 1, lastModified: '' },
    ]);
    const backend = makeBackend();
    const ids = await backend.listProjects();
    expect(ids).toEqual(['abc', 'xyz']);
  });

  it('deleteProject calls delete with project key', async () => {
    const backend = makeBackend();
    await backend.deleteProject('proj-1');
    expect(mockDelete).toHaveBeenCalledWith('project/proj-1');
  });

  // --- settings ---

  it('saveSettings calls put with settings key', async () => {
    const backend = makeBackend();
    await backend.saveSettings({ language: 'en' } as Parameters<typeof backend.saveSettings>[0]);
    expect(mockPut).toHaveBeenCalledWith('settings', expect.any(String));
  });

  it('loadSettings returns null when not found', async () => {
    const backend = makeBackend();
    const result = await backend.loadSettings();
    expect(result).toBeNull();
  });

  it('hasSavedData returns false when list is empty', async () => {
    const backend = makeBackend();
    const result = await backend.hasSavedData();
    expect(result).toBe(false);
  });

  it('hasSavedData returns true when projects exist', async () => {
    mockList.mockResolvedValueOnce([{ key: 'project/1', size: 1, lastModified: '' }]);
    const backend = makeBackend();
    const result = await backend.hasSavedData();
    expect(result).toBe(true);
  });

  // --- Security: methods that MUST throw ---

  it('saveImage throws (images are local-only)', async () => {
    const backend = makeBackend();
    await expect(backend.saveImage('img-1', 'base64data')).rejects.toThrow('local-only');
  });

  it('getImage throws (images are local-only)', async () => {
    const backend = makeBackend();
    await expect(backend.getImage('img-1')).rejects.toThrow('local-only');
  });

  it('saveGeminiApiKey throws (API keys are local-only)', async () => {
    const backend = makeBackend();
    await expect(backend.saveGeminiApiKey('sk-abc')).rejects.toThrow('API keys');
  });

  it('getGeminiApiKey throws (API keys are local-only)', async () => {
    const backend = makeBackend();
    await expect(backend.getGeminiApiKey()).rejects.toThrow('API keys');
  });

  it('listSnapshots throws (snapshots are local-only)', async () => {
    const backend = makeBackend();
    await expect(backend.listSnapshots()).rejects.toThrow('local-only');
  });

  it('saveApiKey throws (API keys are local-only)', async () => {
    const backend = makeBackend();
    await expect(backend.saveApiKey('openai', 'key')).rejects.toThrow('API keys');
  });

  // --- LWW conflict resolution (P2-1) ---

  it('saveProject wraps data in CloudSyncPayload envelope with meta', async () => {
    const backend = makeBackend();
    await backend.saveProject({
      present: {
        data: { id: 'p1', title: 'T', sections: [] } as unknown as ReturnType<typeof Object>,
      },
    } as Parameters<typeof backend.saveProject>[0]);
    expect(mockPut).toHaveBeenCalledOnce();
    const [, blob] = mockPut.mock.calls[0] as [string, string];
    const payload = JSON.parse(blob) as {
      data: unknown;
      meta: { lastModified: number; deviceId: string; version: number };
    };
    // QNBS-v3: verify meta fields exist (LWW envelope)
    expect(payload.meta).toBeDefined();
    expect(typeof payload.meta.lastModified).toBe('number');
    expect(typeof payload.meta.deviceId).toBe('string');
    expect(payload.meta.version).toBe(1);
    expect(payload.data).toBeDefined();
  });

  it('loadWithMetadata returns null for missing key', async () => {
    mockGet.mockResolvedValueOnce(null);
    const backend = makeBackend();
    // loadProject delegates to loadWithMetadata
    const result = await backend.loadProject('missing-project');
    expect(result).toBeNull();
  });
});
