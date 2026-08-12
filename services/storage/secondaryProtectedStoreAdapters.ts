/**
 * Authoritative adapters for secondary stores that have a plaintext routing shell and protected content payload.
 * QNBS-v3: Unknown record shapes fail recovery rather than dropping forward-compatible data or preserving secrets.
 */

import {
  type ProtectedStoreAdapter,
  ProtectedStoreMigrationAdapterError,
} from './protectedStoreMigration';
import {
  createSecondaryPayloadStoreAdapter,
  type SecondaryPayloadStoreAdapterSpec,
} from './secondaryPayloadStoreAdapter';
import type { SecureRecordEnvelope } from './storageEncryptionService';

const SCENE_REVISIONS_DB = 'worldscript-revisions-db';
const SCENE_REVISIONS_STORE = 'scene-revisions';
const INFERENCE_CACHE_DB = 'worldscript-inference-cache-db';
const INFERENCE_CACHE_STORE = 'inference-cache';

interface SceneRevisionPayload {
  title: string;
  content: string;
  wordCount: number;
  label?: string;
  authorName?: string;
}

interface SceneRevisionRecord extends Record<string, unknown> {
  id: string;
  sectionId: string;
  createdAt: number;
  schemaVersion?: number;
  payload?: unknown;
  title?: string;
  content?: string;
  wordCount?: number;
  label?: string;
  authorName?: string;
}

interface CachePayload {
  result: string;
}

interface CacheRecord extends Record<string, unknown> {
  key: string;
  timestamp: number;
  payload?: unknown;
  result?: string;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  store: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ProtectedStoreMigrationAdapterError(
      `${store} contains an unsupported record schema; recovery must preserve it before migration`,
    );
  }
}

// QNBS-v3: IndexedDB allows numeric keys, so an unvalidated routing key would persist a non-string journal cursor that parseJournal() later rejects into recovery-required; fail fast instead.
function assertStringRoutingKey(value: unknown, field: string, store: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtectedStoreMigrationAdapterError(
      `${store} record has a non-string ${field}; recovery must reconcile it before migration`,
    );
  }
  return value;
}

function isSceneRevisionPayload(value: unknown): value is SceneRevisionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<SceneRevisionPayload>;
  return (
    typeof payload.title === 'string' &&
    typeof payload.content === 'string' &&
    typeof payload.wordCount === 'number' &&
    (payload.label === undefined || typeof payload.label === 'string') &&
    (payload.authorName === undefined || typeof payload.authorName === 'string')
  );
}

function isCachePayload(value: unknown): value is CachePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<CachePayload>).result === 'string'
  );
}

function scenePayload(record: SceneRevisionRecord): unknown {
  if (record.payload !== undefined) {
    assertExactKeys(
      record,
      ['id', 'sectionId', 'createdAt', 'schemaVersion', 'payload'],
      'scene revisions',
    );
    if (record.schemaVersion !== 1) {
      throw new ProtectedStoreMigrationAdapterError(
        'Scene revisions have an unsupported schema version',
      );
    }
    return record.payload;
  }
  assertExactKeys(
    record,
    ['id', 'sectionId', 'createdAt', 'title', 'content', 'wordCount', 'label', 'authorName'],
    'scene revisions',
  );
  return {
    title: record.title,
    content: record.content,
    wordCount: record.wordCount,
    ...(record.label !== undefined ? { label: record.label } : {}),
    ...(record.authorName !== undefined ? { authorName: record.authorName } : {}),
  };
}

function cachePayload(record: CacheRecord): unknown {
  if (record.payload !== undefined) {
    assertExactKeys(record, ['key', 'timestamp', 'payload'], 'inference cache');
    return record.payload;
  }
  assertExactKeys(record, ['key', 'timestamp', 'result'], 'inference cache');
  return { result: record.result };
}

const sceneRevisionAdapterSpec: SecondaryPayloadStoreAdapterSpec<
  SceneRevisionRecord,
  SceneRevisionPayload
> = {
  id: `${SCENE_REVISIONS_DB}/${SCENE_REVISIONS_STORE}`,
  databaseName: SCENE_REVISIONS_DB,
  storeName: SCENE_REVISIONS_STORE,
  recordId: (record) => assertStringRoutingKey(record.id, 'id', 'scene revisions'),
  context: (recordId) => ({
    store: `${SCENE_REVISIONS_DB}/${SCENE_REVISIONS_STORE}`,
    recordId,
    legacyStores: [SCENE_REVISIONS_STORE],
  }),
  payload: scenePayload,
  isPayload: isSceneRevisionPayload,
  withPayload: (record, payload: SceneRevisionPayload | SecureRecordEnvelope) => ({
    id: record.id,
    sectionId: record.sectionId,
    createdAt: record.createdAt,
    schemaVersion: 1,
    payload,
  }),
};

const inferenceCacheAdapterSpec: SecondaryPayloadStoreAdapterSpec<CacheRecord, CachePayload> = {
  id: `${INFERENCE_CACHE_DB}/${INFERENCE_CACHE_STORE}`,
  databaseName: INFERENCE_CACHE_DB,
  storeName: INFERENCE_CACHE_STORE,
  recordId: (record) => assertStringRoutingKey(record.key, 'key', 'inference cache'),
  context: (recordId) => ({
    store: `${INFERENCE_CACHE_DB}/${INFERENCE_CACHE_STORE}`,
    recordId,
    legacyStores: [INFERENCE_CACHE_STORE],
  }),
  payload: cachePayload,
  isPayload: isCachePayload,
  withPayload: (record, payload: CachePayload | SecureRecordEnvelope) => ({
    key: record.key,
    timestamp: record.timestamp,
    payload,
  }),
};

/** Return a fresh immutable adapter list so migration callers cannot mutate the central registration. */
export function getRegisteredSecondaryProtectedStoreAdapters(): readonly ProtectedStoreAdapter[] {
  return [
    createSecondaryPayloadStoreAdapter(sceneRevisionAdapterSpec),
    createSecondaryPayloadStoreAdapter(inferenceCacheAdapterSpec),
  ];
}
