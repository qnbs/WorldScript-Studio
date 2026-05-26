/**
 * Tests for ProForge structured output utilities and Zod schemas.
 * QNBS-v3: Pure logic — no mocks, no IDB, no AI calls.
 */

import { describe, expect, it } from 'vitest';
import {
  audiobookGuideSchema,
  blurbsSchema,
  bookMetadataSchema,
  copyEditPlanSchema,
  diagnosticReportSchema,
  grammarEditSchema,
  manuscriptProfileSchema,
  pacingReportSchema,
  pipelineAnalyticsReportSchema,
  pipelineMetricsSchema,
  proseEditBatchSchema,
  proseEditSchema,
  proseMetricsSchema,
  publishingPackageSchema,
  qualityGateReportSchema,
  qualityScoreSchema,
  repetitionHitSchema,
  severitySchema,
  stripJsonFences,
  structuralEditPlanSchema,
  structuralEditSchema,
  validateWithSchema,
} from '../../../services/proForge/pipelineOutput/structuredOutput';

// ---------------------------------------------------------------------------
// stripJsonFences
// ---------------------------------------------------------------------------

describe('stripJsonFences', () => {
  it('removes ```json ... ``` fences', () => {
    const input = '```json\n{"key":"value"}\n```';
    expect(stripJsonFences(input)).toBe('{"key":"value"}');
  });

  it('removes ``` ... ``` fences (no language tag)', () => {
    const input = '```\n{"key":"value"}\n```';
    expect(stripJsonFences(input)).toBe('{"key":"value"}');
  });

  it('handles uppercase JSON tag', () => {
    const input = '```JSON\n{"x":1}\n```';
    expect(stripJsonFences(input)).toBe('{"x":1}');
  });

  it('returns trimmed plain JSON unchanged', () => {
    const input = '{"x":1}';
    expect(stripJsonFences(input)).toBe('{"x":1}');
  });

  it('trims surrounding whitespace', () => {
    const input = '  \n{"x":1}\n  ';
    expect(stripJsonFences(input)).toBe('{"x":1}');
  });

  it('handles empty string', () => {
    expect(stripJsonFences('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateWithSchema
// ---------------------------------------------------------------------------

describe('validateWithSchema', () => {
  it('returns success:true for valid data', () => {
    const result = validateWithSchema(severitySchema, 'critical');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('critical');
  });

  it('returns success:false for invalid data', () => {
    const result = validateWithSchema(severitySchema, 'unknown-value');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it('error string contains the path for nested failures', () => {
    const result = validateWithSchema(qualityScoreSchema, {
      overall: 150, // out of range
      prose: 50,
      structure: 50,
      consistency: 50,
      pacing: 50,
      dialogue: 50,
      marketability: 50,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('overall');
  });

  it('works with complex nested schemas', () => {
    const validProfile = {
      wordCount: 50000,
      sectionCount: 20,
      averageSectionLength: 2500,
      detectedGenre: 'fantasy',
      pacingEstimate: 'moderate',
      povType: 'third-limited',
      tense: 'past',
    };
    const result = validateWithSchema(manuscriptProfileSchema, validProfile);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// severitySchema
// ---------------------------------------------------------------------------

describe('severitySchema', () => {
  it.each(['critical', 'warning', 'info'])('accepts "%s"', (v) => {
    expect(severitySchema.safeParse(v).success).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(severitySchema.safeParse('error').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// manuscriptProfileSchema
// ---------------------------------------------------------------------------

describe('manuscriptProfileSchema', () => {
  it('accepts minimal required fields', () => {
    const result = manuscriptProfileSchema.safeParse({
      wordCount: 0,
      sectionCount: 0,
      averageSectionLength: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative wordCount', () => {
    expect(
      manuscriptProfileSchema.safeParse({
        wordCount: -1,
        sectionCount: 0,
        averageSectionLength: 0,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// qualityScoreSchema
// ---------------------------------------------------------------------------

describe('qualityScoreSchema', () => {
  const valid = {
    overall: 75,
    prose: 80,
    structure: 70,
    consistency: 85,
    pacing: 60,
    dialogue: 90,
    marketability: 55,
  };

  it('accepts valid scores', () => {
    expect(qualityScoreSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects score > 100', () => {
    expect(qualityScoreSchema.safeParse({ ...valid, overall: 101 }).success).toBe(false);
  });

  it('rejects score < 0', () => {
    expect(qualityScoreSchema.safeParse({ ...valid, prose: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// diagnosticReportSchema
// ---------------------------------------------------------------------------

describe('diagnosticReportSchema', () => {
  const validReport = {
    profile: {
      wordCount: 10000,
      sectionCount: 5,
      averageSectionLength: 2000,
    },
    consistencyIssues: [],
    structuralGaps: [],
    qualityScore: {
      overall: 70,
      prose: 70,
      structure: 70,
      consistency: 70,
      pacing: 70,
      dialogue: 70,
      marketability: 70,
    },
    summary: 'A solid draft.',
  };

  it('accepts a valid report', () => {
    expect(diagnosticReportSchema.safeParse(validReport).success).toBe(true);
  });

  it('rejects summary longer than 2000 chars', () => {
    expect(
      diagnosticReportSchema.safeParse({ ...validReport, summary: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('rejects more than 50 consistency issues', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      type: 'character',
      description: 'issue',
      sectionIds: [],
      severity: 'info',
    }));
    expect(
      diagnosticReportSchema.safeParse({ ...validReport, consistencyIssues: tooMany }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// structuralEditSchema
// ---------------------------------------------------------------------------

describe('structuralEditSchema', () => {
  it('accepts a valid structural edit', () => {
    const result = structuralEditSchema.safeParse({
      id: 'edit-1',
      sectionId: 'sec-1',
      category: 'pacing',
      rationale: 'Too slow here',
      confidence: 0.8,
    });
    expect(result.success).toBe(true);
  });

  it('rejects confidence > 1', () => {
    expect(
      structuralEditSchema.safeParse({
        id: 'x',
        sectionId: 'y',
        category: 'pacing',
        rationale: 'test',
        confidence: 1.1,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// proseEditSchema
// ---------------------------------------------------------------------------

describe('proseEditSchema', () => {
  it('accepts a valid prose edit', () => {
    const result = proseEditSchema.safeParse({
      id: 'p1',
      sectionId: 's1',
      startOffset: 0,
      endOffset: 10,
      category: 'filterWord',
      original: 'She heard a sound.',
      proposed: 'A sound broke the silence.',
      rationale: 'Filter word removed',
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative startOffset', () => {
    expect(
      proseEditSchema.safeParse({
        id: 'p1',
        sectionId: 's1',
        startOffset: -1,
        endOffset: 10,
        category: 'filterWord',
        original: 'x',
        proposed: 'y',
        rationale: 'r',
        confidence: 0.5,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// proseMetricsSchema
// ---------------------------------------------------------------------------

describe('proseMetricsSchema', () => {
  it('accepts valid metrics', () => {
    expect(
      proseMetricsSchema.safeParse({
        adverbDensity: 0.05,
        filterWordDensity: 0.03,
        dialogueRatio: 40,
        sensoryScore: 60,
        showDontTellScore: 70,
        povConsistencyScore: 90,
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// grammarEditSchema
// ---------------------------------------------------------------------------

describe('grammarEditSchema', () => {
  it('accepts a valid grammar edit', () => {
    expect(
      grammarEditSchema.safeParse({
        id: 'g1',
        sectionId: 's1',
        startOffset: 5,
        endOffset: 15,
        ruleId: 'COMMA_SPLICE',
        ruleName: 'Comma Splice',
        original: 'He ran, she walked.',
        proposed: 'He ran; she walked.',
        explanation: 'Comma splice fixed',
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repetitionHitSchema
// ---------------------------------------------------------------------------

describe('repetitionHitSchema', () => {
  it('accepts a valid repetition hit', () => {
    expect(
      repetitionHitSchema.safeParse({
        id: 'r1',
        wordOrPhrase: 'suddenly',
        occurrences: [
          { sectionId: 's1', startOffset: 0, endOffset: 8 },
          { sectionId: 's2', startOffset: 5, endOffset: 13 },
        ],
        count: 2,
      }).success,
    ).toBe(true);
  });

  it('rejects count < 2', () => {
    expect(
      repetitionHitSchema.safeParse({
        id: 'r1',
        wordOrPhrase: 'suddenly',
        occurrences: [{ sectionId: 's1', startOffset: 0, endOffset: 8 }],
        count: 1,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pacingReportSchema
// ---------------------------------------------------------------------------

describe('pacingReportSchema', () => {
  it('accepts a valid pacing report', () => {
    expect(
      pacingReportSchema.safeParse({
        sectionPacing: [
          {
            sectionId: 's1',
            sectionTitle: 'Chapter 1',
            tensionScore: 7,
            wordCount: 3000,
            recommendedAction: 'keep',
          },
        ],
        overallPacing: 'uneven',
        suggestions: ['Trim chapter 3'],
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pipelineMetricsSchema
// ---------------------------------------------------------------------------

describe('pipelineMetricsSchema', () => {
  it('accepts valid pipeline metrics', () => {
    expect(
      pipelineMetricsSchema.safeParse({
        totalDurationMs: 120000,
        totalAiCalls: 8,
        totalTokensConsumed: 50000,
        stageDurations: { intake: 15000, structural: 30000 },
        totalEditsFound: 42,
        totalEditsAccepted: 35,
        totalEditsRejected: 7,
        qualityImprovement: 12.5,
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// structuralEditPlanSchema
// ---------------------------------------------------------------------------

describe('structuralEditPlanSchema', () => {
  it('accepts a valid edit plan', () => {
    const result = structuralEditPlanSchema.safeParse({
      edits: [],
      pacingReport: {
        sectionPacing: [],
        overallPacing: 'moderate',
        suggestions: [],
      },
      summary: 'Structure looks solid.',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// proseEditBatchSchema
// ---------------------------------------------------------------------------

describe('proseEditBatchSchema', () => {
  const metrics = {
    adverbDensity: 0.04,
    filterWordDensity: 0.02,
    dialogueRatio: 35,
    sensoryScore: 65,
    showDontTellScore: 75,
    povConsistencyScore: 88,
  };

  it('accepts a valid prose edit batch', () => {
    expect(
      proseEditBatchSchema.safeParse({
        edits: [],
        beforeMetrics: metrics,
        summary: 'Prose improvements applied.',
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bookMetadataSchema
// ---------------------------------------------------------------------------

describe('bookMetadataSchema', () => {
  it('accepts valid book metadata', () => {
    expect(
      bookMetadataSchema.safeParse({
        title: 'Test Novel',
        author: 'Test Author',
        description: 'A gripping story.',
        keywords: ['fantasy', 'epic'],
        genre: 'Fantasy',
        bisacCodes: ['FIC009010'],
        language: 'en',
        wordCount: 90000,
      }).success,
    ).toBe(true);
  });

  it('rejects too many keywords (>10)', () => {
    expect(
      bookMetadataSchema.safeParse({
        title: 'T',
        author: 'A',
        description: 'D',
        keywords: Array.from({ length: 11 }, (_, i) => `kw${i}`),
        genre: 'Fiction',
        bisacCodes: [],
        language: 'en',
        wordCount: 1000,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pipelineAnalyticsReportSchema
// ---------------------------------------------------------------------------

describe('pipelineAnalyticsReportSchema', () => {
  const metrics = {
    totalDurationMs: 60000,
    totalAiCalls: 5,
    totalTokensConsumed: 20000,
    stageDurations: {},
    totalEditsFound: 10,
    totalEditsAccepted: 8,
    totalEditsRejected: 2,
    qualityImprovement: 5,
  };

  it('accepts a valid analytics report', () => {
    expect(
      pipelineAnalyticsReportSchema.safeParse({
        runId: 'run-123',
        metrics,
        lessonsLearned: {
          whatWorked: ['Prose pass'],
          whatDidntWork: [],
          recommendations: ['Run again'],
          authorNotes: 'Good session',
        },
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// blurbsSchema
// ---------------------------------------------------------------------------

describe('blurbsSchema', () => {
  it('accepts valid blurbs', () => {
    expect(
      blurbsSchema.safeParse({
        backCover: 'A gripping tale of adventure.',
        amazonDescription: 'Full Amazon description here...',
        tagline: 'One chance. One choice.',
        elevatorPitch: 'A hero must choose between love and duty.',
        socialMediaPosts: ['Coming soon!'],
      }).success,
    ).toBe(true);
  });

  it('rejects tagline longer than 200 chars', () => {
    expect(
      blurbsSchema.safeParse({
        backCover: 'b',
        amazonDescription: 'a',
        tagline: 'x'.repeat(201),
        elevatorPitch: 'e',
        socialMediaPosts: [],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// audiobookGuideSchema
// ---------------------------------------------------------------------------

describe('audiobookGuideSchema', () => {
  it('accepts a valid audiobook guide', () => {
    expect(
      audiobookGuideSchema.safeParse({
        chapterMarks: [
          {
            sectionId: 's1',
            title: 'Chapter 1',
            estimatedDurationMinutes: 25,
            narratorNotes: 'Slow intro',
          },
        ],
        overallNotes: 'Dramatic reading throughout.',
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// copyEditPlanSchema
// ---------------------------------------------------------------------------

describe('copyEditPlanSchema', () => {
  it('accepts an empty but valid copy edit plan', () => {
    expect(
      copyEditPlanSchema.safeParse({
        grammarEdits: [],
        styleEdits: [],
        repetitionHits: [],
        formatIssues: [],
        summary: 'No issues found.',
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// qualityGateReportSchema
// ---------------------------------------------------------------------------

describe('qualityGateReportSchema', () => {
  const passSection = { pass: true, score: 90, issues: [] };
  const passLegal = { pass: true, score: 100, warnings: [] };
  const passReadability = {
    pass: true,
    score: 80,
    metrics: {
      fleschKincaid: 8,
      fleschReadingEase: 65,
      targetAgeMin: 14,
      targetAgeMax: 99,
      appropriateForGenre: true,
    },
  };

  it('accepts a valid quality gate report (all pass)', () => {
    expect(
      qualityGateReportSchema.safeParse({
        overallPass: true,
        grammar: passSection,
        style: passSection,
        technical: passSection,
        legal: passLegal,
        readability: passReadability,
        summary: 'All checks passed.',
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// publishingPackageSchema
// ---------------------------------------------------------------------------

describe('publishingPackageSchema', () => {
  it('accepts a valid publishing package', () => {
    const pkg = {
      metadata: {
        title: 'Great Novel',
        author: 'J. Doe',
        description: 'A great novel.',
        keywords: ['drama'],
        genre: 'Literary Fiction',
        bisacCodes: ['FIC000000'],
        language: 'en',
        wordCount: 80000,
      },
      blurbs: {
        backCover: 'Back cover text.',
        amazonDescription: 'Amazon description.',
        tagline: 'Change is coming.',
        elevatorPitch: 'A story about change.',
        socialMediaPosts: [],
      },
      audiobookGuide: {
        chapterMarks: [],
        overallNotes: 'Standard narration.',
      },
      marketingAssets: {
        socialMediaPosts: [],
        newsletterText: 'Newsletter copy.',
        adCopyVariants: [],
        authorBioSuggestion: 'J. Doe is a debut author.',
      },
      rightsPage: '© 2026 J. Doe. All rights reserved.',
    };
    expect(publishingPackageSchema.safeParse(pkg).success).toBe(true);
  });
});
