/**
 * ProForge Structured Output — Zod schemas for AI agent outputs.
 * QNBS-v3: Strict validation of all AI-generated pipeline artifacts.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared Primitives
// ---------------------------------------------------------------------------

export const severitySchema = z.enum(['critical', 'warning', 'info']);
export const reviewItemStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'ignored']);

// ---------------------------------------------------------------------------
// Phase 1: Diagnostic
// ---------------------------------------------------------------------------

export const manuscriptProfileSchema = z.object({
  wordCount: z.number().int().min(0),
  sectionCount: z.number().int().min(0),
  averageSectionLength: z.number().min(0),
  detectedGenre: z.string().optional(),
  pacingEstimate: z.enum(['fast', 'moderate', 'slow']).optional(),
  povType: z.enum(['first', 'third-limited', 'third-omniscient', 'second', 'mixed']).optional(),
  tense: z.enum(['past', 'present']).optional(),
});

export const consistencyIssueSchema = z.object({
  id: z.string(),
  type: z.enum(['character', 'timeline', 'world', 'plot', 'object']),
  entityName: z.string().optional(),
  description: z.string(),
  sectionIds: z.array(z.string()),
  severity: severitySchema,
});

export const structuralGapSchema = z.object({
  id: z.string(),
  type: z.enum([
    'missingArc',
    'underdevelopedCharacter',
    'pacingIssue',
    'weakAct',
    'unresolvedThread',
  ]),
  description: z.string(),
  affectedSectionIds: z.array(z.string()),
  suggestion: z.string(),
});

export const qualityScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  prose: z.number().min(0).max(100),
  structure: z.number().min(0).max(100),
  consistency: z.number().min(0).max(100),
  pacing: z.number().min(0).max(100),
  dialogue: z.number().min(0).max(100),
  marketability: z.number().min(0).max(100),
});

export const diagnosticReportSchema = z.object({
  profile: manuscriptProfileSchema,
  consistencyIssues: z.array(consistencyIssueSchema).max(50),
  structuralGaps: z.array(structuralGapSchema).max(30),
  qualityScore: qualityScoreSchema,
  recommendedConfig: z
    .object({
      genrePreset: z.string().optional(),
      selectedStages: z.array(z.string()).optional(),
    })
    .optional(),
  summary: z.string().max(2000),
});

export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;

// ---------------------------------------------------------------------------
// Phase 2: Structural
// ---------------------------------------------------------------------------

export const structuralEditSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  sectionTitle: z.string().optional(),
  range: z.object({ start: z.number().min(0), end: z.number().min(0) }).optional(),
  category: z.enum(['pacing', 'arc', 'structure', 'boundary', 'reorder']),
  original: z.string().optional(),
  proposed: z.string().optional(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

export const pacingReportSchema = z.object({
  sectionPacing: z.array(
    z.object({
      sectionId: z.string(),
      sectionTitle: z.string(),
      tensionScore: z.number().min(0).max(10),
      wordCount: z.number().min(0),
      recommendedAction: z.enum(['expand', 'compress', 'keep']).optional(),
    }),
  ),
  overallPacing: z.enum(['fast', 'moderate', 'slow', 'uneven']),
  suggestions: z.array(z.string()),
});

export const structuralEditPlanSchema = z.object({
  edits: z.array(structuralEditSchema).max(100),
  pacingReport: pacingReportSchema,
  summary: z.string().max(2000),
});

export type StructuralEditPlan = z.infer<typeof structuralEditPlanSchema>;

// ---------------------------------------------------------------------------
// Phase 3: Prose
// ---------------------------------------------------------------------------

export const proseEditSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  sectionTitle: z.string().optional(),
  startOffset: z.number().min(0),
  endOffset: z.number().min(0),
  category: z.enum([
    'showDontTell',
    'filterWord',
    'dialogue',
    'pov',
    'sensory',
    'weakVerb',
    'adverb',
  ]),
  original: z.string(),
  proposed: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

export const proseMetricsSchema = z.object({
  adverbDensity: z.number().min(0),
  filterWordDensity: z.number().min(0),
  dialogueRatio: z.number().min(0).max(100),
  sensoryScore: z.number().min(0).max(100),
  showDontTellScore: z.number().min(0).max(100),
  povConsistencyScore: z.number().min(0).max(100),
});

export const proseEditBatchSchema = z.object({
  edits: z.array(proseEditSchema).max(200),
  beforeMetrics: proseMetricsSchema,
  afterMetrics: proseMetricsSchema.optional(),
  summary: z.string().max(2000),
});

export type ProseEditBatch = z.infer<typeof proseEditBatchSchema>;

// ---------------------------------------------------------------------------
// Phase 4: Copy Edit
// ---------------------------------------------------------------------------

export const grammarEditSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  startOffset: z.number().min(0),
  endOffset: z.number().min(0),
  ruleId: z.string(),
  ruleName: z.string(),
  original: z.string(),
  proposed: z.string(),
  explanation: z.string(),
});

export const styleEditSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  startOffset: z.number().min(0),
  endOffset: z.number().min(0),
  category: z.enum(['register', 'tone', 'formality', 'redundancy']),
  original: z.string(),
  proposed: z.string(),
  rationale: z.string(),
});

export const repetitionHitSchema = z.object({
  id: z.string(),
  wordOrPhrase: z.string(),
  occurrences: z.array(
    z.object({
      sectionId: z.string(),
      startOffset: z.number().min(0),
      endOffset: z.number().min(0),
    }),
  ),
  count: z.number().min(2),
  suggestion: z.string().optional(),
});

export const copyEditPlanSchema = z.object({
  grammarEdits: z.array(grammarEditSchema).max(150),
  styleEdits: z.array(styleEditSchema).max(100),
  repetitionHits: z.array(repetitionHitSchema).max(50),
  formatIssues: z
    .array(
      z.object({
        id: z.string(),
        sectionId: z.string(),
        issue: z.string(),
        suggestion: z.string(),
      }),
    )
    .max(50),
  summary: z.string().max(2000),
});

export type CopyEditPlan = z.infer<typeof copyEditPlanSchema>;

// ---------------------------------------------------------------------------
// Phase 5: Proof / Quality Gate
// ---------------------------------------------------------------------------

export const legalWarningSchema = z.object({
  id: z.string(),
  type: z.enum(['trademark', 'realPerson', 'sensitiveContent', 'copyright', 'defamation']),
  description: z.string(),
  affectedText: z.string().optional(),
  sectionId: z.string().optional(),
  severity: z.enum(['critical', 'warning']),
  recommendation: z.string(),
});

export const readabilityScoreSchema = z.object({
  fleschKincaid: z.number(),
  fleschReadingEase: z.number(),
  targetAgeMin: z.number().int(),
  targetAgeMax: z.number().int(),
  appropriateForGenre: z.boolean(),
});

export const qualityGateReportSchema = z.object({
  overallPass: z.boolean(),
  grammar: z.object({
    pass: z.boolean(),
    score: z.number().min(0).max(100),
    issues: z.array(grammarEditSchema).max(50),
  }),
  style: z.object({
    pass: z.boolean(),
    score: z.number().min(0).max(100),
    issues: z.array(styleEditSchema).max(50),
  }),
  technical: z.object({
    pass: z.boolean(),
    score: z.number().min(0).max(100),
    issues: z.array(z.object({ id: z.string(), issue: z.string() })).max(50),
  }),
  legal: z.object({
    pass: z.boolean(),
    score: z.number().min(0).max(100),
    warnings: z.array(legalWarningSchema).max(20),
  }),
  readability: z.object({
    pass: z.boolean(),
    score: z.number().min(0).max(100),
    metrics: readabilityScoreSchema,
  }),
  summary: z.string().max(2000),
});

export type QualityGateReport = z.infer<typeof qualityGateReportSchema>;

// ---------------------------------------------------------------------------
// Phase 7: Publishing
// ---------------------------------------------------------------------------

export const bookMetadataSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  author: z.string(),
  description: z.string(),
  keywords: z.array(z.string()).max(10),
  genre: z.string(),
  bisacCodes: z.array(z.string()).max(5),
  language: z.string(),
  pageCount: z.number().int().optional(),
  wordCount: z.number().int(),
});

export const blurbsSchema = z.object({
  backCover: z.string().max(1500),
  amazonDescription: z.string().max(4000),
  tagline: z.string().max(200),
  elevatorPitch: z.string().max(500),
  socialMediaPosts: z.array(z.string()).max(5),
});

export const audiobookGuideSchema = z.object({
  chapterMarks: z.array(
    z.object({
      sectionId: z.string(),
      title: z.string(),
      estimatedDurationMinutes: z.number().min(0),
      narratorNotes: z.string().optional(),
      pronunciationNotes: z.array(z.object({ word: z.string(), phonetic: z.string() })).optional(),
    }),
  ),
  overallNotes: z.string(),
});

export const marketingAssetsSchema = z.object({
  socialMediaPosts: z.array(z.object({ platform: z.string(), text: z.string() })).max(10),
  newsletterText: z.string(),
  adCopyVariants: z.array(z.string()).max(5),
  authorBioSuggestion: z.string(),
});

export const publishingPackageSchema = z.object({
  metadata: bookMetadataSchema,
  blurbs: blurbsSchema,
  audiobookGuide: audiobookGuideSchema,
  marketingAssets: marketingAssetsSchema,
  rightsPage: z.string(),
});

export type PublishingPackage = z.infer<typeof publishingPackageSchema>;

// ---------------------------------------------------------------------------
// Phase 8: Analytics
// ---------------------------------------------------------------------------

export const pipelineMetricsSchema = z.object({
  totalDurationMs: z.number().min(0),
  totalAiCalls: z.number().int().min(0),
  totalTokensConsumed: z.number().int().min(0),
  stageDurations: z.record(z.string(), z.number().min(0)),
  totalEditsFound: z.number().int().min(0),
  totalEditsAccepted: z.number().int().min(0),
  totalEditsRejected: z.number().int().min(0),
  qualityImprovement: z.number(),
});

export const lessonsLearnedSchema = z.object({
  whatWorked: z.array(z.string()),
  whatDidntWork: z.array(z.string()),
  recommendations: z.array(z.string()),
  authorNotes: z.string(),
});

export const pipelineAnalyticsReportSchema = z.object({
  runId: z.string(),
  metrics: pipelineMetricsSchema,
  lessonsLearned: lessonsLearnedSchema,
  comparisonToPreviousRuns: z
    .array(
      z.object({
        runId: z.string(),
        runLabel: z.string(),
        qualityImprovement: z.number(),
        durationMs: z.number(),
      }),
    )
    .optional(),
});

export type PipelineAnalyticsReport = z.infer<typeof pipelineAnalyticsReportSchema>;

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

export function validateWithSchema<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}

// QNBS-v3: Strip both ```json and plain ``` code fences that AI models often wrap responses in.
export function stripJsonFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}
