/**
 * Tests for services/proForge/proForgeCapabilitySchemas.ts — the Zod input schemas that gate every
 * Core Capability Layer op (shared by the in-app UI and the MCP server). Validates defaults and the
 * min(1) guards that turn empty strings into VALIDATION errors instead of silent "latest run" fallbacks.
 */

import { describe, expect, it } from 'vitest';

import {
  applyEditsInputSchema,
  getHistoryInputSchema,
  getSupervisorStatusInputSchema,
  ProForgeError,
  projectPayloadSchema,
  ragQueryInputSchema,
  runStageInputSchema,
} from '../../../services/proForge/proForgeCapabilitySchemas';

describe('runStageInputSchema', () => {
  it('accepts a valid executable stage and defaults dryRun to false', () => {
    const parsed = runStageInputSchema.parse({ stage: 'intake', projectId: 'p1' });
    expect(parsed.dryRun).toBe(false);
    expect(parsed.stage).toBe('intake');
  });

  it('rejects a non-executable / unknown stage', () => {
    expect(runStageInputSchema.safeParse({ stage: 'idle', projectId: 'p1' }).success).toBe(false);
    expect(runStageInputSchema.safeParse({ stage: 'bogus', projectId: 'p1' }).success).toBe(false);
  });

  it('rejects an empty projectId', () => {
    expect(runStageInputSchema.safeParse({ stage: 'intake', projectId: '' }).success).toBe(false);
  });
});

describe('getHistoryInputSchema', () => {
  it('defaults limit to 20', () => {
    expect(getHistoryInputSchema.parse({ projectId: 'p1' }).limit).toBe(20);
  });

  it('rejects limit above 100', () => {
    expect(getHistoryInputSchema.safeParse({ projectId: 'p1', limit: 101 }).success).toBe(false);
  });

  // QNBS-v3: CodeAnt #6 guard — empty runId must be a validation error, not a "latest run" fallback.
  it('rejects an empty-string runId (no silent truthiness collapse)', () => {
    expect(getHistoryInputSchema.safeParse({ projectId: 'p1', runId: '' }).success).toBe(false);
  });

  it('accepts an omitted runId', () => {
    expect(getHistoryInputSchema.safeParse({ projectId: 'p1' }).success).toBe(true);
  });
});

describe('getSupervisorStatusInputSchema', () => {
  it('rejects an empty-string runId', () => {
    expect(getSupervisorStatusInputSchema.safeParse({ projectId: 'p1', runId: '' }).success).toBe(
      false,
    );
  });
});

describe('ragQueryInputSchema', () => {
  it('defaults k to 10 and mode to lexical', () => {
    const parsed = ragQueryInputSchema.parse({ projectId: 'p1', query: 'hero' });
    expect(parsed.k).toBe(10);
    expect(parsed.mode).toBe('lexical');
  });

  it('rejects an empty query and k above 50', () => {
    expect(ragQueryInputSchema.safeParse({ projectId: 'p1', query: '' }).success).toBe(false);
    expect(ragQueryInputSchema.safeParse({ projectId: 'p1', query: 'x', k: 51 }).success).toBe(
      false,
    );
  });
});

describe('applyEditsInputSchema', () => {
  it('defaults dryRun false and section content to empty string', () => {
    const parsed = applyEditsInputSchema.parse({
      manuscript: [{ id: 's1' }],
      items: [{ id: 'ri1' }],
    });
    expect(parsed.dryRun).toBe(false);
    expect(parsed.manuscript[0]?.content).toBe('');
  });

  it('rejects a manuscript section with an empty id', () => {
    const r = applyEditsInputSchema.safeParse({ manuscript: [{ id: '' }], items: [] });
    expect(r.success).toBe(false);
  });
});

describe('projectPayloadSchema', () => {
  it('applies array + string defaults for a minimal payload', () => {
    const parsed = projectPayloadSchema.parse({ projectId: 'p1' });
    expect(parsed.title).toBe('');
    expect(parsed.logline).toBe('');
    expect(parsed.manuscript).toEqual([]);
    expect(parsed.characters).toEqual([]);
    expect(parsed.worlds).toEqual([]);
    expect(parsed.memoryEntries).toEqual([]);
  });

  it('rejects an empty projectId', () => {
    expect(projectPayloadSchema.safeParse({ projectId: '' }).success).toBe(false);
  });
});

describe('ProForgeError', () => {
  it('carries a structured code, message, and optional details', () => {
    const err = new ProForgeError('NOT_FOUND', 'run missing', { runId: 'r9' });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('run missing');
    expect(err.details).toEqual({ runId: 'r9' });
  });
});
