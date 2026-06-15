/** Shared IndexedDB names and store identifiers — keep in sync with upgrade paths in `dbService.ts`. */

export const LEGACY_DB_NAME = 'worldscript-db';

export const STATE_DB_NAME = 'worldscript-state-db';
export const DATA_DB_NAME = 'worldscript-data-db';

/** Current schema version for both state and data DBs. */
// QNBS-v3: v8 — projects-index-store for Cross-Project-Search v2; backwards-compatible addStore migration.
export const DB_VERSION = 8;

/** Privacy-preserving project index for cross-project search — no manuscript plaintext stored. */
export const PROJECTS_INDEX_STORE = 'projects-index-store';

export const APP_DATA_STORE = 'app-data-store';
export const SNAPSHOTS_STORE = 'snapshots-store';
export const IMAGES_STORE = 'images-store';
export const RAG_VECTORS_STORE = 'rag-vectors-store';
export const CODEX_STORE = 'codex-store';
/** Binary binder assets keyed by `makeBinderAssetStorageKey(projectId, assetId)`. */
export const BINDER_ASSETS_STORE = 'binder-assets-store';

/** Written to `APP_DATA_STORE` after a successful legacy → dual-DB copy (idempotency). */
export const LEGACY_DB_MIGRATION_MARKER_KEY = '__legacy_worldscript_db_migrated__';
