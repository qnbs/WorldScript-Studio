/**
 * Coordinates decrypt-to-plaintext (disable) and re-encrypt (rotation) across secondary IDB stores.
 * QNBS-v3: Secondary envelopes must be migrated before clearIdbPassphrase or they become unreadable.
 */

import {
  migrateAiInferenceCacheForDisable,
  reEncryptAiInferenceCache,
} from '../ai/aiInferenceCacheService';
import {
  migrateCrossProjectIndexForDisable,
  reEncryptCrossProjectIndex,
} from '../crossProjectIndexService';
import { migrateLoraStoresForDisable, reEncryptLoraStores } from '../loraAdapterService';
import {
  migrateProForgeHistoryForDisable,
  reEncryptProForgeHistory,
} from '../proForge/proForgeHistoryStore';
import {
  migrateProForgeMemoryForDisable,
  reEncryptProForgeMemory,
} from '../proForge/proForgeMemoryBank';
import { migrateSceneRevisionsForDisable, reEncryptSceneRevisions } from '../sceneRevisionService';

/** Decrypt all secondary secure-record payloads to plaintext while the session key is active. */
export async function decryptAllSecondaryStoresToPlaintext(): Promise<void> {
  await migrateSceneRevisionsForDisable();
  await migrateAiInferenceCacheForDisable();
  await migrateProForgeMemoryForDisable();
  await migrateProForgeHistoryForDisable();
  await migrateCrossProjectIndexForDisable();
  await migrateLoraStoresForDisable();
}

/** Re-encrypt all secondary secure-record payloads during passphrase rotation. */
export async function reEncryptAllSecondaryStores(
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> {
  await reEncryptSceneRevisions(oldKey, newKey);
  await reEncryptAiInferenceCache(oldKey, newKey);
  await reEncryptProForgeMemory(oldKey, newKey);
  await reEncryptProForgeHistory(oldKey, newKey);
  await reEncryptCrossProjectIndex(oldKey, newKey);
  await reEncryptLoraStores(oldKey, newKey);
}
