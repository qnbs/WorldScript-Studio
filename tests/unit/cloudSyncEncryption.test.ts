// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptCloudPayload,
  deriveCloudSyncKey,
  encryptCloudPayload,
} from '../../services/cloudSync/cloudSyncEncryption';

describe('cloudSyncEncryption', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    key = await deriveCloudSyncKey('test-passphrase', 'user-abc');
  });

  describe('deriveCloudSyncKey', () => {
    it('returns a CryptoKey with AES-GCM algorithm', async () => {
      expect(key.algorithm.name).toBe('AES-GCM');
      expect(key.type).toBe('secret');
    });

    it('derives the same key from the same passphrase + userId', async () => {
      const key2 = await deriveCloudSyncKey('test-passphrase', 'user-abc');
      const enc1 = await encryptCloudPayload(key, { v: 1 });
      const dec2 = await decryptCloudPayload<{ v: number }>(key2, enc1);
      expect(dec2.v).toBe(1);
    });

    it('derives different keys for different userIds', async () => {
      const keyOther = await deriveCloudSyncKey('test-passphrase', 'user-xyz');
      const enc = await encryptCloudPayload(key, { secret: 42 });
      await expect(decryptCloudPayload(keyOther, enc)).rejects.toThrow();
    });
  });

  describe('encryptCloudPayload / decryptCloudPayload round-trip', () => {
    it('round-trips a plain object', async () => {
      const data = { projectId: 'p1', title: 'My Novel', manuscript: [] };
      const enc = await encryptCloudPayload(key, data);
      const dec = await decryptCloudPayload<typeof data>(key, enc);
      expect(dec).toEqual(data);
    });

    it('round-trips a string value', async () => {
      const enc = await encryptCloudPayload(key, 'hello world');
      expect(await decryptCloudPayload<string>(key, enc)).toBe('hello world');
    });

    it('round-trips an array', async () => {
      const enc = await encryptCloudPayload(key, [1, 2, 3]);
      expect(await decryptCloudPayload<number[]>(key, enc)).toEqual([1, 2, 3]);
    });

    it('produces different ciphertext each call (random IV)', async () => {
      const enc1 = await encryptCloudPayload(key, { v: 1 });
      const enc2 = await encryptCloudPayload(key, { v: 1 });
      expect(enc1).not.toBe(enc2);
    });

    it('returns base64 string', async () => {
      const enc = await encryptCloudPayload(key, 42);
      expect(typeof enc).toBe('string');
      expect(() => atob(enc)).not.toThrow();
    });

    it('throws on tampered ciphertext', async () => {
      const enc = await encryptCloudPayload(key, { secret: true });
      const tampered = enc.slice(0, -4) + 'XXXX';
      await expect(decryptCloudPayload(key, tampered)).rejects.toThrow();
    });
  });
});
