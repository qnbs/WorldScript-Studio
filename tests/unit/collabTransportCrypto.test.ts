// @vitest-environment node
// QNBS-v3: Covers the vendored y-webrtc fork's RTCDataChannel E2E encryption (C-1) — the SC-patched
// crypto layer (PBKDF2 600k, AES-256-GCM, extractable:false), NOT the broader y-webrtc.js transport.
// Uses Node's global webcrypto; no network, no RTCPeerConnection.

import { describe, expect, it } from 'vitest';

import {
  decrypt,
  decryptJson,
  deriveKey,
  encrypt,
  encryptJson,
} from '../../packages/collab-transport/src/crypto.js';

const enc = new TextEncoder();

describe('collab-transport crypto (vendored y-webrtc E2E fork)', () => {
  describe('deriveKey', () => {
    it('derives a non-extractable AES-GCM key usable for encrypt/decrypt', async () => {
      const key = (await deriveKey('s3cret', 'room-1')) as CryptoKey;
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
      expect(key.extractable).toBe(false); // SC-SEC: prevents subtle.exportKey
      expect(key.usages).toEqual(expect.arrayContaining(['encrypt', 'decrypt']));
    });

    it('is deterministic — same secret + room derive interoperable keys', async () => {
      const a = (await deriveKey('pw', 'roomX')) as CryptoKey;
      const b = (await deriveKey('pw', 'roomX')) as CryptoKey;
      const cipher = await encrypt(enc.encode('hello'), a);
      const plain = await decrypt(cipher, b);
      expect(new TextDecoder().decode(plain)).toBe('hello');
    });

    it('uses the room name as salt — a different room cannot decrypt', async () => {
      const k1 = (await deriveKey('pw', 'roomA')) as CryptoKey;
      const k2 = (await deriveKey('pw', 'roomB')) as CryptoKey;
      const cipher = await encrypt(enc.encode('secret'), k1);
      await expect(decrypt(cipher, k2)).rejects.toBeDefined();
    });
  });

  describe('encrypt / decrypt roundtrip', () => {
    it('round-trips arbitrary bytes', async () => {
      const key = (await deriveKey('pw', 'r')) as CryptoKey;
      const data = enc.encode('the quick brown fox 🦊');
      const cipher = await encrypt(data, key);
      // ciphertext must differ from plaintext and carry the AES-GCM header + IV
      expect(Array.from(cipher)).not.toEqual(Array.from(data));
      const plain = await decrypt(cipher, key);
      expect(new TextDecoder().decode(plain)).toBe('the quick brown fox 🦊');
    });

    it('uses a fresh random IV per call (ciphertexts differ for identical input)', async () => {
      const key = (await deriveKey('pw', 'r')) as CryptoKey;
      const data = enc.encode('same input');
      const c1 = await encrypt(data, key);
      const c2 = await encrypt(data, key);
      expect(Array.from(c1)).not.toEqual(Array.from(c2));
      // both still decrypt back to the original
      expect(new TextDecoder().decode(await decrypt(c1, key))).toBe('same input');
      expect(new TextDecoder().decode(await decrypt(c2, key))).toBe('same input');
    });

    it('passes data through untouched when key is null (encryption disabled)', async () => {
      const data = enc.encode('plaintext');
      expect(await encrypt(data, null)).toBe(data);
      expect(await decrypt(data, null)).toBe(data);
    });

    it('rejects a wrong key (AES-GCM auth tag mismatch)', async () => {
      const good = (await deriveKey('pw', 'r')) as CryptoKey;
      const bad = (await deriveKey('different', 'r')) as CryptoKey;
      const cipher = await encrypt(enc.encode('x'), good);
      await expect(decrypt(cipher, bad)).rejects.toBeDefined();
    });

    it('rejects an unknown encryption algorithm header (SC-SEC: no silent swallow)', async () => {
      const key = (await deriveKey('pw', 'r')) as CryptoKey;
      // Hand-craft a lib0-encoded payload whose algorithm varstring is NOT "AES-GCM":
      // [varUint len=5]['R','O','T','1','3'] [varUint ivLen=3][1,2,3] [varUint cipherLen=3][4,5,6].
      // (lib0 varUint for values < 128 is a single byte, so this matches writeVarString/Uint8Array.)
      const payload = new Uint8Array([5, 0x52, 0x4f, 0x54, 0x31, 0x33, 3, 1, 2, 3, 3, 4, 5, 6]);
      await expect(decrypt(payload, key)).rejects.toThrow(/Unknown encryption algorithm/);
    });
  });

  describe('encryptJson / decryptJson roundtrip', () => {
    it('round-trips a structured object', async () => {
      const key = (await deriveKey('pw', 'r')) as CryptoKey;
      const obj = { type: 'awareness', clientId: 42, payload: [1, 2, 3], nested: { ok: true } };
      const cipher = await encryptJson(obj, key);
      const out = await decryptJson(cipher, key);
      expect(out).toEqual(obj);
    });

    it('round-trips through the null-key passthrough', async () => {
      const obj = { a: 1 };
      const cipher = await encryptJson(obj, null);
      const out = await decryptJson(cipher, null);
      expect(out).toEqual(obj);
    });
  });
});
