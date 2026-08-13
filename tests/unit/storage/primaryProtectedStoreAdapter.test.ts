// @vitest-environment node
// QNBS-v3: node env for Blob support without jsdom's non-functional indexedDB stub.
import { describe, expect, it } from 'vitest';
import { isKeyStoreRecordKey } from '../../../services/storage/idbKeyStore';
import { __valuesMatchForTest as valuesMatch } from '../../../services/storage/primaryProtectedStoreAdapter';

// QNBS-v3 (CodeAnt #342): the optimistic-write freshness check must compare Blob *content*, not
// just size/type — two Blobs can share both while holding entirely different bytes (e.g. a
// concurrent binder-asset re-upload), which the prior shallow check would wrongly treat as unchanged.
describe('valuesMatch — Blob content comparison', () => {
  it('returns true for two Blobs with identical bytes (even as distinct instances)', async () => {
    const left = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' });
    const right = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' });
    await expect(valuesMatch(left, right)).resolves.toBe(true);
  });

  it('returns false for two Blobs with the same size and MIME type but different bytes', async () => {
    const left = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' });
    const right = new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'application/pdf' });
    await expect(valuesMatch(left, right)).resolves.toBe(false);
  });

  it('returns false for two Blobs with different sizes', async () => {
    const left = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' });
    const right = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' });
    await expect(valuesMatch(left, right)).resolves.toBe(false);
  });

  it('returns false for two Blobs with different MIME types', async () => {
    const left = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' });
    const right = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await expect(valuesMatch(left, right)).resolves.toBe(false);
  });

  it('compares Blobs nested inside plain objects', async () => {
    const left = { meta: { name: 'a' }, blob: new Blob([new Uint8Array([1, 2])]) };
    const right = { meta: { name: 'a' }, blob: new Blob([new Uint8Array([1, 2])]) };
    await expect(valuesMatch(left, right)).resolves.toBe(true);

    const mutated = { meta: { name: 'a' }, blob: new Blob([new Uint8Array([9, 9])]) };
    await expect(valuesMatch(left, mutated)).resolves.toBe(false);
  });

  it('still handles the pre-existing non-Blob cases (Uint8Array, arrays, plain objects)', async () => {
    await expect(valuesMatch(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).resolves.toBe(
      true,
    );
    await expect(valuesMatch(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).resolves.toBe(
      false,
    );
    await expect(valuesMatch([1, 'a', true], [1, 'a', true])).resolves.toBe(true);
    await expect(valuesMatch({ a: 1, b: 2 }, { b: 2, a: 1 })).resolves.toBe(true);
    await expect(valuesMatch({ a: 1 }, { a: 2 })).resolves.toBe(false);
  });
});

// QNBS-v3 (CodeAnt/qodo #342): the app-data primary-store adapter must never touch IdbKeyStore's
// records — see primaryProtectedStoreAdapters.ts's appDataAdapterSpec.isReservedKey wiring.
describe('isKeyStoreRecordKey', () => {
  it('reserves the raw local CryptoKey record', () => {
    expect(isKeyStoreRecordKey('local_crypto_key_v2')).toBe(true);
  });

  it('reserves the legacy Gemini API key + IV records', () => {
    expect(isKeyStoreRecordKey('gemini_api_key_encrypted_v1')).toBe(true);
    expect(isKeyStoreRecordKey('gemini_api_key_iv_v1')).toBe(true);
  });

  it('reserves per-provider api_key_<provider>_enc/_iv records for any provider name', () => {
    expect(isKeyStoreRecordKey('api_key_openai_enc')).toBe(true);
    expect(isKeyStoreRecordKey('api_key_openai_iv')).toBe(true);
    expect(isKeyStoreRecordKey('api_key_claude_enc')).toBe(true);
    expect(isKeyStoreRecordKey('api_key_ollama-local_enc')).toBe(true);
  });

  it('does not reserve ordinary project/settings keys', () => {
    expect(isKeyStoreRecordKey('project-data')).toBe(false);
    expect(isKeyStoreRecordKey('settings')).toBe(false);
    expect(isKeyStoreRecordKey('api_key_openai')).toBe(false); // missing _enc/_iv suffix
  });

  it('does not reserve non-string keys', () => {
    expect(isKeyStoreRecordKey(42)).toBe(false);
  });
});
