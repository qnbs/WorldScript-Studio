/**
 * ProForge Capability Layer — Zod schemas + standardized error types.
 * QNBS-v3: Single validation surface shared by the browser adapter, the Node/MCP adapter, and the
 * unit tests. Pure module — imports only `zod` and ProForge types. No Redux/IDB/browser globals.
 */

import { z } from 'zod';
import type { PipelineStage } from '../../features/proForge/types';

// ---------------------------------------------------------------------------
// Stage enums
// ---------------------------------------------------------------------------

/** Stages with an executable agent (excludes idle/archived control states). */
export const executableStageSchema = z.enum([
  'intake',
  'structural',
  'lineProse',
  'copyEdit',
  'proof',
  'production',
  'publishing',
  'analytics',
]);

export const pipelineStageSchema = z.enum([
  'idle',
  'intake',
  'structural',
  'lineProse',
  'copyEdit',
  'proof',
  'production',
  'publishing',
  'analytics',
  'archived',
]) satisfies z.ZodType<PipelineStage>;

export const ragModeSchema = z.enum(['lexical', 'semantic', 'hybrid']);
export const creativitySchema = z.enum(['Focused', 'Balanced', 'Imaginative']);

// ---------------------------------------------------------------------------
// Portable project payload (Node/MCP input — untrusted)
// ---------------------------------------------------------------------------

export const manuscriptSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  content: z.string().default(''),
});

export const namedEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
});

export const memoryEntrySeedSchema = z.object({
  id: z.string().optional(),
  category: z.enum(['lore', 'character', 'style', 'feedback', 'edit', 'meta']),
  key: z.string(),
  content: z.string(),
  sourceStage: pipelineStageSchema.default('idle'),
});

/**
 * Supervisor quality-gate thresholds. Sub-fields are required so the inferred type matches
 * `QualityThresholds` exactly (both fields present); callers override the pair as a unit, and the
 * SupervisorAgent re-merges against DEFAULT_QUALITY_THRESHOLDS internally.
 */
export const qualityThresholdsSchema = z.object({
  largeManuscriptWords: z.number().int().positive(),
  // QNBS-v3: intake quality scores are on a 0–100 scale; bound the gate so an impossible
  // threshold (>100) can't make every intake fail unconditionally via misconfiguration.
  intakeHardGate: z.number().min(0).max(100),
});

/** Overridable run configuration (all optional — merged onto defaults). */
export const partialPipelineConfigSchema = z.object({
  genrePreset: z.string().optional(),
  styleGuide: z.string().optional(),
  aiProvider: z.string().optional(),
  ragMode: ragModeSchema.optional(),
  maxTokens: z.number().int().positive().optional(),
  creativity: creativitySchema.optional(),
  language: z.string().optional(),
  useDuckDb: z.boolean().optional(),
  autoAcceptThreshold: z.number().min(0).max(1).optional(),
  // QNBS-v3: PR6 — accept supervisor threshold overrides so Node/MCP capability callers can tune
  // quality gates (the schema previously stripped this key, silently dropping caller overrides).
  qualityThresholds: qualityThresholdsSchema.optional(),
});
export type PartialPipelineConfigInput = z.infer<typeof partialPipelineConfigSchema>;

export const projectPayloadSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().default(''),
  logline: z.string().default(''),
  manuscript: z.array(manuscriptSectionSchema).default([]),
  characters: z.array(namedEntitySchema).default([]),
  worlds: z.array(namedEntitySchema).default([]),
  memoryEntries: z.array(memoryEntrySeedSchema).default([]),
  config: partialPipelineConfigSchema.optional(),
});
export type ProjectPayload = z.infer<typeof projectPayloadSchema>;

// ---------------------------------------------------------------------------
// Op: runStage
// ---------------------------------------------------------------------------

export const runStageInputSchema = z.object({
  stage: executableStageSchema,
  projectId: z.string().min(1),
  /** When true, run the agent but do not persist any memory/history side effects. */
  dryRun: z.boolean().default(false),
  config: partialPipelineConfigSchema.optional(),
});
export type RunStageInput = z.infer<typeof runStageInputSchema>;

// ---------------------------------------------------------------------------
// Op: getHistory
// ---------------------------------------------------------------------------

export const getHistoryInputSchema = z.object({
  projectId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(20),
  // QNBS-v3: min(1) so an empty string is a VALIDATION error, not silently coerced to
  // "no filter" → returning the latest run (CodeAnt #6). Optional still allows omission.
  /** Optional: filter to a single run. */
  runId: z.string().min(1).optional(),
});
export type GetHistoryInput = z.infer<typeof getHistoryInputSchema>;

// ---------------------------------------------------------------------------
// Op: applyEdits (pure)
// ---------------------------------------------------------------------------

/** Lean review-item shape — only the fields applyReviewEdits actually consumes. */
export const editItemSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().optional(),
  range: z.object({ start: z.number(), end: z.number() }).optional(),
  original: z.string().optional(),
  proposed: z.string().optional(),
});

export const applyEditsInputSchema = z.object({
  manuscript: z.array(z.object({ id: z.string().min(1), content: z.string().default('') })),
  items: z.array(editItemSchema),
  dryRun: z.boolean().default(false),
});
export type ApplyEditsInput = z.infer<typeof applyEditsInputSchema>;

// ---------------------------------------------------------------------------
// Op: ragQuery
// ---------------------------------------------------------------------------

export const ragQueryInputSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  k: z.number().int().positive().max(50).default(10),
  mode: ragModeSchema.default('lexical'),
});
export type RagQueryInput = z.infer<typeof ragQueryInputSchema>;

// ---------------------------------------------------------------------------
// Op: getSupervisorStatus
// ---------------------------------------------------------------------------

export const getSupervisorStatusInputSchema = z.object({
  projectId: z.string().min(1),
  // QNBS-v3: min(1) — empty string must be a VALIDATION error rather than truthiness-collapsing to
  // "no id" and returning the most-recent run (CodeAnt #6).
  /** Defaults to the most recent run for the project. */
  runId: z.string().min(1).optional(),
});
export type GetSupervisorStatusInput = z.infer<typeof getSupervisorStatusInputSchema>;

// ---------------------------------------------------------------------------
// Standardized error type
// ---------------------------------------------------------------------------

export type ProForgeErrorCode =
  | 'VALIDATION'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'STAGE_FAILED'
  | 'INTERNAL';

/**
 * Single error type for all capability-layer operations. Both the MCP server and the in-app UI
 * narrow on `.code` to produce structured tool errors / friendly toasts respectively.
 */
export class ProForgeError extends Error {
  readonly code: ProForgeErrorCode;
  readonly details?: unknown;

  constructor(code: ProForgeErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ProForgeError';
    this.code = code;
    // QNBS-v3: only assign details when provided — exactOptionalPropertyTypes.
    if (details !== undefined) this.details = details;
  }

  static validation(message: string, details?: unknown): ProForgeError {
    return new ProForgeError('VALIDATION', message, details);
  }
  static permissionDenied(message: string): ProForgeError {
    return new ProForgeError('PERMISSION_DENIED', message);
  }
  static notFound(message: string): ProForgeError {
    return new ProForgeError('NOT_FOUND', message);
  }
  static stageFailed(message: string, details?: unknown): ProForgeError {
    return new ProForgeError('STAGE_FAILED', message, details);
  }
  static internal(message: string, details?: unknown): ProForgeError {
    return new ProForgeError('INTERNAL', message, details);
  }

  toResult(): { error: { code: ProForgeErrorCode; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}

/** Parse with a schema, throwing a ProForgeError(VALIDATION) on failure. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, opName: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw ProForgeError.validation(
      `Invalid input for ${opName}`,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
