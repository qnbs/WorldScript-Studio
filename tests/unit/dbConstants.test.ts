import { describe, expect, it } from 'vitest';
import {
  APP_DATA_STORE,
  BINDER_ASSETS_STORE,
  CODEX_STORE,
  DATA_DB_NAME,
  DB_VERSION,
  IMAGES_STORE,
  LEGACY_DB_MIGRATION_MARKER_KEY,
  LEGACY_DB_NAME,
  RAG_VECTORS_STORE,
  SNAPSHOTS_STORE,
  STATE_DB_NAME,
} from '../../services/dbConstants';

describe('dbConstants', () => {
  it('exports correct DB names', () => {
    expect(LEGACY_DB_NAME).toBe('worldscript-db');
    expect(STATE_DB_NAME).toBe('worldscript-state-db');
    expect(DATA_DB_NAME).toBe('worldscript-data-db');
  });

  it('exports DB version as a positive number', () => {
    expect(typeof DB_VERSION).toBe('number');
    expect(DB_VERSION).toBeGreaterThan(0);
  });

  it('exports all store names as non-empty strings', () => {
    expect(APP_DATA_STORE).toBeTruthy();
    expect(SNAPSHOTS_STORE).toBeTruthy();
    expect(IMAGES_STORE).toBeTruthy();
    expect(RAG_VECTORS_STORE).toBeTruthy();
    expect(CODEX_STORE).toBeTruthy();
    expect(BINDER_ASSETS_STORE).toBeTruthy();
  });

  it('exports migration marker key', () => {
    expect(LEGACY_DB_MIGRATION_MARKER_KEY).toBeTruthy();
    expect(typeof LEGACY_DB_MIGRATION_MARKER_KEY).toBe('string');
  });

  it('all store names are unique', () => {
    const stores = [
      APP_DATA_STORE,
      SNAPSHOTS_STORE,
      IMAGES_STORE,
      RAG_VECTORS_STORE,
      CODEX_STORE,
      BINDER_ASSETS_STORE,
    ];
    const unique = new Set(stores);
    expect(unique.size).toBe(stores.length);
  });
});
