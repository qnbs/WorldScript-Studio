/**
 * Tests for services/duckdb/duckdbSchema.ts
 * QNBS-v3: Pure constants — verifies schema version, embedding dim, DDL strings contain expected tables.
 */

import { describe, expect, it } from 'vitest';
import {
  DUCK_DB_SCHEMA_VERSION,
  DUCKDB_DDL,
  DUCKDB_MIGRATION_V2_DDL,
  RAG_EMBEDDING_DIM,
} from '../../../services/duckdb/duckdbSchema';

describe('duckdbSchema constants', () => {
  it('DUCK_DB_SCHEMA_VERSION is 2', () => {
    expect(DUCK_DB_SCHEMA_VERSION).toBe(2);
  });

  it('RAG_EMBEDDING_DIM is 384', () => {
    expect(RAG_EMBEDDING_DIM).toBe(384);
  });
});

describe('DUCKDB_DDL', () => {
  it('contains _meta table', () => {
    expect(DUCKDB_DDL).toContain('_meta');
  });

  it('contains projects table', () => {
    expect(DUCKDB_DDL).toContain('projects');
  });

  it('contains sections table', () => {
    expect(DUCKDB_DDL).toContain('sections');
  });

  it('contains writing_history table', () => {
    expect(DUCKDB_DDL).toContain('writing_history');
  });

  it('contains writing_sessions table', () => {
    expect(DUCKDB_DDL).toContain('writing_sessions');
  });

  it('is a non-empty string', () => {
    expect(DUCKDB_DDL.trim().length).toBeGreaterThan(100);
  });
});

describe('DUCKDB_MIGRATION_V2_DDL', () => {
  it('alters rag_chunks to add embedding column', () => {
    expect(DUCKDB_MIGRATION_V2_DDL).toContain('rag_chunks');
    expect(DUCKDB_MIGRATION_V2_DDL).toContain('embedding');
    expect(DUCKDB_MIGRATION_V2_DDL).toContain('FLOAT[]');
  });
});
