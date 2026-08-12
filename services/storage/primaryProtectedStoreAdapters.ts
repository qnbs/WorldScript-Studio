/**
 * Authoritative adapters for primary stores whose protected content is the entire stored value.
 * QNBS-v3: Unknown record shapes fail recovery rather than dropping forward-compatible data or preserving secrets.
 */

import {
  APP_DATA_STORE,
  BINDER_ASSETS_STORE,
  CODEX_STORE,
  DATA_DB_NAME,
  IMAGES_STORE,
  SNAPSHOTS_STORE,
  STATE_DB_NAME,
} from '../dbConstants';
import type { BinderAssetMeta } from '../storageBackend';
import { ENCRYPTION_MIGRATION_JOURNAL_RECORD_KEY } from './encryptionMigrationJournal';
import { compressData, decompressData } from './idbCore';
import { PASSPHRASE_SENTINEL_RECORD_KEY } from './idbPassphraseSentinel';
import {
  createPrimaryProtectedStoreAdapter,
  NO_CHANGE,
  type PrimaryProtectedStoreAdapterSpec,
} from './primaryProtectedStoreAdapter';
import type {
  ProtectedStoreAdapter,
  ProtectedStoreAdapterContext,
} from './protectedStoreMigration';
import { ProtectedStoreMigrationAdapterError } from './protectedStoreMigration';
import { getRegisteredRagVectorsProtectedStoreAdapter } from './ragVectorsProtectedStoreAdapter';
import { idbDecryptWithKey, idbEncryptWithKey, isEncryptedBlob } from './storageEncryptionService';

const APP_DATA_ADAPTER_ID = `${STATE_DB_NAME}/${APP_DATA_STORE}`;
const SNAPSHOTS_ADAPTER_ID = `${STATE_DB_NAME}/${SNAPSHOTS_STORE}`;
const IMAGES_ADAPTER_ID = `${DATA_DB_NAME}/${IMAGES_STORE}`;
const BINDER_ASSETS_ADAPTER_ID = `${DATA_DB_NAME}/${BINDER_ASSETS_STORE}`;
const CODEX_ADAPTER_ID = `${DATA_DB_NAME}/${CODEX_STORE}`;

function requireKey(
  key: CryptoKey | undefined,
  kind: 'source' | 'target',
  adapterId: string,
): CryptoKey {
  if (!key) {
    throw new ProtectedStoreMigrationAdapterError(
      `${adapterId} requires a ${kind} key for the protected-store operation`,
    );
  }
  return key;
}

interface WholeValueCodec<T> {
  /** Convert a legacy/plain stored value into the logical plaintext to encrypt. */
  decodeLegacy(value: unknown): T;
  /** Convert decrypted plaintext back into the shape a legacy/plain store expects (only used for 'disable'). */
  encodeLegacy(value: T): unknown;
}

/** Generic whole-value transform for stores whose entire value is either an EncryptedBlob or a legacy/plain shape. */
async function transformWholeValue<T>(
  adapterId: string,
  value: unknown,
  context: ProtectedStoreAdapterContext,
  codec: WholeValueCodec<T>,
): Promise<unknown | typeof NO_CHANGE> {
  switch (context.operation) {
    case 'enable': {
      if (isEncryptedBlob(value)) return NO_CHANGE;
      const targetKey = requireKey(context.targetKey, 'target', adapterId);
      return idbEncryptWithKey(targetKey, codec.decodeLegacy(value));
    }
    case 'rekey': {
      const sourceKey = requireKey(context.sourceKey, 'source', adapterId);
      const targetKey = requireKey(context.targetKey, 'target', adapterId);
      if (!isEncryptedBlob(value)) {
        return idbEncryptWithKey(targetKey, codec.decodeLegacy(value));
      }
      try {
        await idbDecryptWithKey(targetKey, value);
        // QNBS-v3: already re-encrypted with the target key by a prior interrupted rekey batch.
        return NO_CHANGE;
      } catch (targetError) {
        try {
          const plain = await idbDecryptWithKey<T>(sourceKey, value);
          return idbEncryptWithKey(targetKey, plain);
        } catch {
          throw targetError;
        }
      }
    }
    case 'disable': {
      if (!isEncryptedBlob(value)) return NO_CHANGE;
      const sourceKey = requireKey(context.sourceKey, 'source', adapterId);
      const plain = await idbDecryptWithKey<T>(sourceKey, value);
      return codec.encodeLegacy(plain);
    }
  }
}

async function verifyWholeValue(
  adapterId: string,
  value: unknown,
  context: Omit<ProtectedStoreAdapterContext, 'cursor'>,
): Promise<void> {
  if (context.operation === 'disable') {
    if (isEncryptedBlob(value)) {
      throw new ProtectedStoreMigrationAdapterError(
        `${adapterId} retained ciphertext after disable`,
      );
    }
    return;
  }
  if (!isEncryptedBlob(value)) {
    throw new ProtectedStoreMigrationAdapterError(
      `${adapterId} retained plaintext after migration`,
    );
  }
  const targetKey = requireKey(context.targetKey, 'target', adapterId);
  await idbDecryptWithKey(targetKey, value);
}

// ─── Images ──────────────────────────────────────────────────────────────────

function decodeImageLegacy(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ProtectedStoreMigrationAdapterError(
      `${IMAGES_ADAPTER_ID} record has an unsupported shape`,
    );
  }
  return value;
}

const imagesAdapterSpec: PrimaryProtectedStoreAdapterSpec = {
  id: IMAGES_ADAPTER_ID,
  databaseName: DATA_DB_NAME,
  storeName: IMAGES_STORE,
  keyMode: 'explicit',
  keyType: 'string',
  transform: (_key, value, context) =>
    transformWholeValue(IMAGES_ADAPTER_ID, value, context, {
      decodeLegacy: decodeImageLegacy,
      encodeLegacy: (value) => value,
    }),
  verifyValue: (_key, value, context) => verifyWholeValue(IMAGES_ADAPTER_ID, value, context),
};

// ─── App data (project / settings) ──────────────────────────────────────────

const appDataAdapterSpec: PrimaryProtectedStoreAdapterSpec = {
  id: APP_DATA_ADAPTER_ID,
  databaseName: STATE_DB_NAME,
  storeName: APP_DATA_STORE,
  keyMode: 'explicit',
  keyType: 'string',
  // QNBS-v3: the migration journal and the passphrase sentinel live in the same physical store —
  // both are lifecycle metadata the migration itself depends on and must never rewrite.
  reservedKeys: [ENCRYPTION_MIGRATION_JOURNAL_RECORD_KEY, PASSPHRASE_SENTINEL_RECORD_KEY],
  transform: (_key, value, context) =>
    transformWholeValue(APP_DATA_ADAPTER_ID, value, context, {
      decodeLegacy: (value) => decompressData<unknown>(value),
      encodeLegacy: (value) => compressData(value),
    }),
  verifyValue: (_key, value, context) => verifyWholeValue(APP_DATA_ADAPTER_ID, value, context),
};

// ─── Snapshots ───────────────────────────────────────────────────────────────

interface SnapshotRecord {
  id: number;
  date: string;
  name: string;
  wordCount: number;
  data: unknown;
}

function asSnapshotRecord(key: IDBValidKey, value: unknown): SnapshotRecord {
  if (typeof value !== 'object' || value === null || !('data' in value)) {
    throw new ProtectedStoreMigrationAdapterError(
      `${SNAPSHOTS_ADAPTER_ID}/${String(key)} has an unsupported shape`,
    );
  }
  return value as SnapshotRecord;
}

const snapshotsAdapterSpec: PrimaryProtectedStoreAdapterSpec = {
  id: SNAPSHOTS_ADAPTER_ID,
  databaseName: STATE_DB_NAME,
  storeName: SNAPSHOTS_STORE,
  keyMode: 'inline',
  keyType: 'number',
  async transform(key, value, context) {
    const record = asSnapshotRecord(key, value);
    const nextData = await transformWholeValue(SNAPSHOTS_ADAPTER_ID, record.data, context, {
      decodeLegacy: (value) => decompressData<unknown>(value),
      encodeLegacy: (value) => compressData(value),
    });
    return nextData === NO_CHANGE ? NO_CHANGE : { ...record, data: nextData };
  },
  verifyValue: (key, value, context) =>
    verifyWholeValue(SNAPSHOTS_ADAPTER_ID, asSnapshotRecord(key, value).data, context),
};

// ─── Binder assets (Blob <-> bytes) ─────────────────────────────────────────

interface BinderAssetPlain {
  meta: BinderAssetMeta;
  blob: Blob;
}

interface BinderAssetCryptoPayload {
  meta: BinderAssetMeta;
  bytes: number[];
}

function isBinderAssetPlain(value: unknown): value is BinderAssetPlain {
  return (
    typeof value === 'object' &&
    value !== null &&
    'blob' in value &&
    (value as { blob: unknown }).blob instanceof Blob &&
    'meta' in value
  );
}

function isBinderAssetCryptoPayload(value: unknown): value is BinderAssetCryptoPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bytes' in value &&
    Array.isArray((value as { bytes: unknown }).bytes) &&
    'meta' in value
  );
}

async function blobToCryptoPayload(plain: BinderAssetPlain): Promise<BinderAssetCryptoPayload> {
  const buffer = await plain.blob.arrayBuffer();
  return { meta: plain.meta, bytes: Array.from(new Uint8Array(buffer)) };
}

function cryptoPayloadToBlob(payload: BinderAssetCryptoPayload): BinderAssetPlain {
  const mimeType = payload.meta.mimeType || 'application/octet-stream';
  return {
    meta: payload.meta,
    blob: new Blob([new Uint8Array(payload.bytes)], { type: mimeType }),
  };
}

async function encodeBinderAssetForKey(key: CryptoKey, value: unknown): Promise<Uint8Array> {
  if (!isBinderAssetPlain(value)) {
    throw new ProtectedStoreMigrationAdapterError(
      `${BINDER_ASSETS_ADAPTER_ID} record has an unsupported shape`,
    );
  }
  return idbEncryptWithKey(key, await blobToCryptoPayload(value));
}

async function transformBinderAsset(
  value: unknown,
  context: ProtectedStoreAdapterContext,
): Promise<unknown | typeof NO_CHANGE> {
  switch (context.operation) {
    case 'enable': {
      if (isEncryptedBlob(value)) return NO_CHANGE;
      const targetKey = requireKey(context.targetKey, 'target', BINDER_ASSETS_ADAPTER_ID);
      return encodeBinderAssetForKey(targetKey, value);
    }
    case 'rekey': {
      const sourceKey = requireKey(context.sourceKey, 'source', BINDER_ASSETS_ADAPTER_ID);
      const targetKey = requireKey(context.targetKey, 'target', BINDER_ASSETS_ADAPTER_ID);
      if (!isEncryptedBlob(value)) return encodeBinderAssetForKey(targetKey, value);
      try {
        await idbDecryptWithKey(targetKey, value);
        return NO_CHANGE;
      } catch (targetError) {
        try {
          const payload = await idbDecryptWithKey<BinderAssetCryptoPayload>(sourceKey, value);
          if (!isBinderAssetCryptoPayload(payload)) {
            throw new ProtectedStoreMigrationAdapterError(
              `${BINDER_ASSETS_ADAPTER_ID} decrypted to an unsupported shape`,
            );
          }
          return idbEncryptWithKey(targetKey, payload);
        } catch {
          throw targetError;
        }
      }
    }
    case 'disable': {
      if (!isEncryptedBlob(value)) return NO_CHANGE;
      const sourceKey = requireKey(context.sourceKey, 'source', BINDER_ASSETS_ADAPTER_ID);
      const payload = await idbDecryptWithKey<BinderAssetCryptoPayload>(sourceKey, value);
      if (!isBinderAssetCryptoPayload(payload)) {
        throw new ProtectedStoreMigrationAdapterError(
          `${BINDER_ASSETS_ADAPTER_ID} decrypted to an unsupported shape`,
        );
      }
      return cryptoPayloadToBlob(payload);
    }
  }
}

const binderAssetsAdapterSpec: PrimaryProtectedStoreAdapterSpec = {
  id: BINDER_ASSETS_ADAPTER_ID,
  databaseName: DATA_DB_NAME,
  storeName: BINDER_ASSETS_STORE,
  keyMode: 'explicit',
  keyType: 'string',
  transform: (_key, value, context) => transformBinderAsset(value, context),
  async verifyValue(_key, value, context) {
    if (context.operation === 'disable') {
      if (isEncryptedBlob(value)) {
        throw new ProtectedStoreMigrationAdapterError(
          `${BINDER_ASSETS_ADAPTER_ID} retained ciphertext after disable`,
        );
      }
      if (!isBinderAssetPlain(value)) {
        throw new ProtectedStoreMigrationAdapterError(
          `${BINDER_ASSETS_ADAPTER_ID} has an unsupported shape after disable`,
        );
      }
      return;
    }
    if (!isEncryptedBlob(value)) {
      throw new ProtectedStoreMigrationAdapterError(
        `${BINDER_ASSETS_ADAPTER_ID} retained plaintext after migration`,
      );
    }
    const targetKey = requireKey(context.targetKey, 'target', BINDER_ASSETS_ADAPTER_ID);
    const payload = await idbDecryptWithKey<BinderAssetCryptoPayload>(targetKey, value);
    if (!isBinderAssetCryptoPayload(payload)) {
      throw new ProtectedStoreMigrationAdapterError(
        `${BINDER_ASSETS_ADAPTER_ID} decrypted to an unsupported shape`,
      );
    }
  },
};

// ─── Codex (3-shape dispatch) ────────────────────────────────────────────────

interface CodexEncryptedShape {
  projectId: string;
  encrypted: number[];
}

interface CodexCompressedShape {
  projectId: string;
  compressedUtf16: string;
}

function isCodexEncryptedShape(value: unknown): value is CodexEncryptedShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'encrypted' in value &&
    Array.isArray((value as { encrypted: unknown }).encrypted)
  );
}

function isCodexCompressedShape(value: unknown): value is CodexCompressedShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'compressedUtf16' in value &&
    typeof (value as { compressedUtf16: unknown }).compressedUtf16 === 'string'
  );
}

function decodeCodexLegacyPlain(value: unknown): unknown {
  if (isCodexCompressedShape(value)) return decompressData<unknown>(value.compressedUtf16);
  return decompressData<unknown>(value);
}

async function encodeCodexForKey(
  projectId: string,
  key: CryptoKey,
  plain: unknown,
): Promise<CodexEncryptedShape> {
  const bytes = await idbEncryptWithKey(key, plain);
  return { projectId, encrypted: Array.from(bytes) };
}

async function transformCodex(
  key: IDBValidKey,
  value: unknown,
  context: ProtectedStoreAdapterContext,
): Promise<unknown | typeof NO_CHANGE> {
  const projectId = String(key);
  switch (context.operation) {
    case 'enable': {
      if (isCodexEncryptedShape(value)) return NO_CHANGE;
      const targetKey = requireKey(context.targetKey, 'target', CODEX_ADAPTER_ID);
      return encodeCodexForKey(projectId, targetKey, decodeCodexLegacyPlain(value));
    }
    case 'rekey': {
      const sourceKey = requireKey(context.sourceKey, 'source', CODEX_ADAPTER_ID);
      const targetKey = requireKey(context.targetKey, 'target', CODEX_ADAPTER_ID);
      if (!isCodexEncryptedShape(value)) {
        return encodeCodexForKey(projectId, targetKey, decodeCodexLegacyPlain(value));
      }
      const cipher = new Uint8Array(value.encrypted);
      try {
        await idbDecryptWithKey(targetKey, cipher);
        return NO_CHANGE;
      } catch (targetError) {
        try {
          const plain = await idbDecryptWithKey<unknown>(sourceKey, cipher);
          return encodeCodexForKey(projectId, targetKey, plain);
        } catch {
          throw targetError;
        }
      }
    }
    case 'disable': {
      if (!isCodexEncryptedShape(value)) return NO_CHANGE;
      const sourceKey = requireKey(context.sourceKey, 'source', CODEX_ADAPTER_ID);
      const cipher = new Uint8Array(value.encrypted);
      const plain = await idbDecryptWithKey<unknown>(sourceKey, cipher);
      const processed = compressData(plain);
      return typeof processed === 'string' ? { projectId, compressedUtf16: processed } : processed;
    }
  }
}

const codexAdapterSpec: PrimaryProtectedStoreAdapterSpec = {
  id: CODEX_ADAPTER_ID,
  databaseName: DATA_DB_NAME,
  storeName: CODEX_STORE,
  keyMode: 'inline',
  keyType: 'string',
  transform: transformCodex,
  async verifyValue(key, value, context) {
    if (context.operation === 'disable') {
      if (isCodexEncryptedShape(value)) {
        throw new ProtectedStoreMigrationAdapterError(
          `${CODEX_ADAPTER_ID} retained ciphertext after disable`,
        );
      }
      return;
    }
    if (!isCodexEncryptedShape(value)) {
      throw new ProtectedStoreMigrationAdapterError(
        `${CODEX_ADAPTER_ID} retained plaintext after migration`,
      );
    }
    const targetKey = requireKey(context.targetKey, 'target', CODEX_ADAPTER_ID);
    await idbDecryptWithKey(targetKey, new Uint8Array(value.encrypted));
    void key;
  },
};

/** Return a fresh immutable adapter list so migration callers cannot mutate the central registration. */
export function getRegisteredPrimaryProtectedStoreAdapters(): readonly ProtectedStoreAdapter[] {
  return [
    createPrimaryProtectedStoreAdapter(imagesAdapterSpec),
    createPrimaryProtectedStoreAdapter(binderAssetsAdapterSpec),
    createPrimaryProtectedStoreAdapter(codexAdapterSpec),
    createPrimaryProtectedStoreAdapter(appDataAdapterSpec),
    createPrimaryProtectedStoreAdapter(snapshotsAdapterSpec),
    getRegisteredRagVectorsProtectedStoreAdapter(),
  ];
}
