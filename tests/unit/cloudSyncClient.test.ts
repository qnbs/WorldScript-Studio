/**
 * Tests for services/cloudSync/cloudSyncClient.ts
 * QNBS-v3: Covers PUT/GET/DELETE/LIST operations with fetch stubs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudSyncClient, type CloudSyncConfig } from '../../services/cloudSync/cloudSyncClient';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const BASE_CONFIG: CloudSyncConfig = {
  endpoint: 'https://sync.example.com/',
  token: 'test-token',
  bucketPrefix: 'sc-sync',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudSyncClient', () => {
  describe('put', () => {
    it('calls fetch with PUT method and correct URL', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await client.put('project-1', '{"title":"Test"}');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://sync.example.com/sc-sync/project-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('sends Authorization Bearer header', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await client.put('key', 'data');
      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        Authorization: 'Bearer test-token',
      });
    });

    it('throws when response is not ok', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 500, statusText: 'Server Error' }),
      );
      const client = new CloudSyncClient(BASE_CONFIG);
      await expect(client.put('key', 'data')).rejects.toThrow('CloudSync PUT failed: 500');
    });
  });

  describe('get', () => {
    it('returns text content on success', async () => {
      fetchMock.mockResolvedValueOnce(new Response('{"title":"Story"}', { status: 200 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      const result = await client.get('project-1');
      expect(result).toBe('{"title":"Story"}');
    });

    it('returns null on 404', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      const result = await client.get('missing-key');
      expect(result).toBeNull();
    });

    it('throws on non-200 non-404 error', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 403, statusText: 'Forbidden' }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await expect(client.get('key')).rejects.toThrow('CloudSync GET failed: 403');
    });
  });

  describe('delete', () => {
    it('calls fetch with DELETE method', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await client.delete('project-1');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/project-1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not throw on 404 (idempotent delete)', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await expect(client.delete('missing')).resolves.toBeUndefined();
    });

    it('throws on other errors', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500, statusText: 'Error' }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await expect(client.delete('key')).rejects.toThrow('CloudSync DELETE failed: 500');
    });
  });

  describe('list', () => {
    it('returns parsed JSON array on success', async () => {
      const items = [{ key: 'proj-1', size: 100, lastModified: '2026-01-01T00:00:00Z' }];
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(items), { status: 200 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      const result = await client.list();
      expect(result).toEqual(items);
    });

    it('includes prefix param in URL when prefix provided', async () => {
      fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await client.list('user-123');
      expect(fetchMock.mock.calls[0]![0]).toContain('prefix=user-123');
    });

    it('throws when list response is not ok', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 503, statusText: 'Unavailable' }),
      );
      const client = new CloudSyncClient(BASE_CONFIG);
      await expect(client.list()).rejects.toThrow('CloudSync LIST failed: 503');
    });
  });

  describe('URL construction', () => {
    it('strips trailing slash from endpoint', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new CloudSyncClient({ ...BASE_CONFIG, endpoint: 'https://sync.example.com/' });
      await client.put('my-key', 'data');
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toBe('https://sync.example.com/sc-sync/my-key');
    });

    it('URL-encodes keys with special characters', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new CloudSyncClient(BASE_CONFIG);
      await client.put('my key/v2', 'data');
      expect(fetchMock.mock.calls[0]![0]).toContain('my%20key%2Fv2');
    });

    it('uses default bucket prefix when not specified', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new CloudSyncClient({ endpoint: 'https://sync.example.com', token: 'tok' });
      await client.put('key', 'data');
      expect(fetchMock.mock.calls[0]![0]).toContain('/sc-sync/');
    });
  });
});
