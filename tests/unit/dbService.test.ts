import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();
const createFakeStore = () => ({
  put: (value: unknown, key: IDBValidKey) => {
    const request = {
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    Promise.resolve().then(() => {
      storeData.set(String(key), value);
      request.onsuccess?.();
    });
    return request;
  },
  get: (key: IDBValidKey) => {
    const request = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      result: storeData.get(String(key)),
      error: null,
    } as unknown as IDBRequest;
    Promise.resolve().then(() => {
      request.onsuccess?.({} as Event);
    });
    return request;
  },
  delete: (key: IDBValidKey) => {
    const request = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    };
    Promise.resolve().then(() => {
      storeData.delete(String(key));
      request.onsuccess?.({} as Event);
    });
    return request;
  },
  count: () => {
    const request = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      result: storeData.size,
      error: null,
    } as unknown as IDBRequest;
    Promise.resolve().then(() => {
      request.onsuccess?.({} as Event);
    });
    return request;
  },
});

const fakeDb = {
  transaction: vi.fn().mockImplementation(() => ({ objectStore: () => createFakeStore() })),
};

type TestDbService = {
  stateDb?: typeof fakeDb;
  dataDb?: typeof fakeDb;
  saveGeminiApiKey: (key: string) => Promise<void>;
  getGeminiApiKey: () => Promise<string>;
  clearGeminiApiKey: () => Promise<void>;
  saveApiKey: (provider: string, key: string) => Promise<void>;
  getApiKey: (provider: string) => Promise<string>;
  saveStoryCodex: (codex: unknown) => Promise<void>;
  getStoryCodex: (projectId: string) => Promise<unknown>;
  hasGeminiApiKey: () => Promise<boolean>;
  [key: string]: unknown;
};

describe('dbService', () => {
  let dbService: TestDbService;

  beforeEach(async () => {
    storeData.clear();
    vi.resetModules();
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).buffer),
        importKey: vi.fn(async () => ({ type: 'secret', algorithm: { name: 'AES-GCM' } })),
        generateKey: vi.fn(async () => ({
          type: 'secret',
          algorithm: { name: 'AES-GCM' },
          extractable: false,
        })),
        encrypt: vi.fn(async (_algo, _key, data) => data),
        decrypt: vi.fn(async (_algo, _key, data) => data),
      },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    } as unknown as Crypto);

    const mod = await import('../../services/dbService');
    dbService = mod.dbService as unknown as TestDbService;
    dbService.stateDb = fakeDb;
    dbService.dataDb = fakeDb;
  });

  it('should encrypt and decrypt Gemini API keys', async () => {
    await dbService.saveGeminiApiKey('  test-key ');

    expect(storeData.get('gemini_api_key_encrypted_v1')).toEqual(
      Array.from(new TextEncoder().encode('test-key')),
    );
    expect(storeData.get('gemini_api_key_iv_v1')).toEqual([...Array(12).keys()]);

    const apiKey = await dbService.getGeminiApiKey();
    expect(apiKey).toBe('test-key');
  });

  it('should clear Gemini API key values', async () => {
    await dbService.saveGeminiApiKey('secret');
    await dbService.clearGeminiApiKey();

    expect(storeData.has('gemini_api_key_encrypted_v1')).toBe(false);
    expect(storeData.has('gemini_api_key_iv_v1')).toBe(false);
  });

  it('should encrypt and decrypt generic provider API keys', async () => {
    await dbService.saveApiKey('provider', 'provider-secret');
    expect(storeData.get('api_key_provider_enc')).toEqual(
      Array.from(new TextEncoder().encode('provider-secret')),
    );
    expect(storeData.get('api_key_provider_iv')).toEqual([...Array(12).keys()]);

    const providerKey = await dbService.getApiKey('provider');
    expect(providerKey).toBe('provider-secret');
  });

  it('should persist and retrieve story codex entries', async () => {
    const sampleCodex = {
      projectId: 'proj-1',
      extractedAt: new Date().toISOString(),
      summary: 'Test summary',
      entities: [
        {
          id: 'character-hero',
          name: 'Hero',
          type: 'character',
          known: true,
          mentionCount: 1,
          canonicalId: 'c1',
          mentions: [
            {
              sectionId: 's1',
              sectionTitle: 'Chapter 1',
              excerpt: 'Hero enters the scene.',
              count: 1,
            },
          ],
        },
      ],
    };

    await dbService.saveStoryCodex(sampleCodex);
    const loaded = await dbService.getStoryCodex('proj-1');

    expect(loaded).toEqual(sampleCodex);
  });

  it('should return null when generic provider decryption fails', async () => {
    await dbService.saveApiKey('provider', 'provider-secret');
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).buffer),
        importKey: vi.fn(async () => ({})),
        encrypt: vi.fn(async (_algo, _key, data) => data),
        decrypt: vi.fn(async () => {
          throw new Error('decryption failed');
        }),
      },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    } as unknown as Crypto);

    const providerKey = await dbService.getApiKey('provider');
    expect(providerKey).toBeNull();
  });

  it('should report no saved Gemini API key after failed decryption', async () => {
    const originalGetGeminiApiKey = dbService.getGeminiApiKey;
    dbService.getGeminiApiKey = vi.fn().mockResolvedValue(null);

    const result = await dbService.hasGeminiApiKey();
    expect(result).toBe(false);

    dbService.getGeminiApiKey = originalGetGeminiApiKey;
  });

  it('hasGeminiApiKey returns true when a valid key is stored', async () => {
    await dbService.saveGeminiApiKey('valid-key');
    const result = await dbService.hasGeminiApiKey();
    expect(result).toBe(true);
  });

  it('should delete a story codex entry', async () => {
    const codex = {
      projectId: 'proj-del',
      extractedAt: new Date().toISOString(),
      summary: '',
      entities: [],
    };
    await dbService.saveStoryCodex(codex);
    expect(await dbService.getStoryCodex('proj-del')).not.toBeNull();

    const db = dbService as unknown as { deleteStoryCodex: (id: string) => Promise<void> };
    await db.deleteStoryCodex('proj-del');
    expect(await dbService.getStoryCodex('proj-del')).toBeNull();
  });

  it('clearApiKey removes the provider key from storage', async () => {
    await dbService.saveApiKey('openai', 'sk-test');
    expect(storeData.has('api_key_openai_enc')).toBe(true);

    const db = dbService as unknown as { clearApiKey: (p: string) => Promise<void> };
    await db.clearApiKey('openai');

    expect(storeData.has('api_key_openai_enc')).toBe(false);
    expect(storeData.has('api_key_openai_iv')).toBe(false);
  });
});
