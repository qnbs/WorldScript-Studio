import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../services/storageService', () => ({
  storageService: { getApiKey: vi.fn().mockResolvedValue('test-key') },
}));

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Type: { ARRAY: 'ARRAY', OBJECT: 'OBJECT', STRING: 'STRING' },
}));

import { getPrompts } from '../../services/geminiService';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('styleTransfer prompt', () => {
  it('builds a prompt that includes the author style text', () => {
    const result = getPrompts('styleTransfer', {
      lang: 'en',
      authorStyle: 'Hemingway: short sentences, sparse dialogue.',
      passage: 'She walked into the rain.',
    });
    expect(result.prompt).toContain('Hemingway: short sentences, sparse dialogue.');
    expect(result.prompt).toContain('She walked into the rain.');
  });

  it('includes the language instruction in the prompt', () => {
    const result = getPrompts('styleTransfer', {
      lang: 'de',
      authorStyle: 'Gothic style.',
      passage: 'The castle loomed.',
    });
    expect(result.prompt).toContain('German');
  });

  it('references "transformed" and "voiceNotes" JSON keys in the prompt', () => {
    const result = getPrompts('styleTransfer', {
      lang: 'en',
      authorStyle: 'Literary',
      passage: 'Text here.',
    });
    expect(result.prompt).toContain('transformed');
    expect(result.prompt).toContain('voiceNotes');
  });

  it('has no thinkingBudget (synchronous style transfer)', () => {
    const result = getPrompts('styleTransfer', {
      lang: 'en',
      authorStyle: 'Terse',
      passage: 'One line.',
    });
    expect(result.thinkingBudget).toBeUndefined();
  });
});

describe('plotHoleFix prompt', () => {
  it('includes the detected analysis text', () => {
    const result = getPrompts('plotHoleFix', {
      lang: 'en',
      analysis: 'Character X appears in chapter 3 despite dying in chapter 1.',
      manuscript: 'Full manuscript text here.',
    });
    expect(result.prompt).toContain('Character X appears in chapter 3');
  });

  it('includes the manuscript context', () => {
    const result = getPrompts('plotHoleFix', {
      lang: 'en',
      analysis: 'Timeline inconsistency.',
      manuscript: 'Chapter 1: hero starts journey.',
    });
    expect(result.prompt).toContain('Chapter 1: hero starts journey');
  });

  it('references "fixes" JSON key in the prompt', () => {
    const result = getPrompts('plotHoleFix', {
      lang: 'en',
      analysis: 'Gap.',
      manuscript: 'Text.',
    });
    expect(result.prompt).toContain('fixes');
  });

  it('has a thinkingBudget > 0 (extended thinking for fix generation)', () => {
    const result = getPrompts('plotHoleFix', {
      lang: 'en',
      analysis: 'Gap.',
      manuscript: 'Text.',
    });
    expect(result.thinkingBudget ?? 0).toBeGreaterThan(0);
  });
});

describe('chapterAutoGeneration prompt', () => {
  it('includes outline section text', () => {
    const result = getPrompts('chapterAutoGeneration', {
      lang: 'en',
      outlineSection: 'Act II: The hero enters the forest.',
      existingChapters: 'Chapter 1 summary.',
      wordTarget: 1500,
    });
    expect(result.prompt).toContain('Act II: The hero enters the forest.');
  });

  it('includes word target', () => {
    const result = getPrompts('chapterAutoGeneration', {
      lang: 'en',
      outlineSection: 'Section A',
      existingChapters: '',
      wordTarget: 2500,
    });
    expect(result.prompt).toContain('2500');
  });

  it('has extended thinkingBudget of 8192', () => {
    const result = getPrompts('chapterAutoGeneration', {
      lang: 'en',
      outlineSection: 'Section A',
      existingChapters: '',
      wordTarget: 1000,
    });
    expect(result.thinkingBudget).toBe(8192);
  });

  it('references "title", "content", "endingHook", "wordCount" JSON keys', () => {
    const result = getPrompts('chapterAutoGeneration', {
      lang: 'en',
      outlineSection: 'Climax',
      existingChapters: 'Ch1...',
      wordTarget: 1000,
    });
    expect(result.prompt).toContain('title');
    expect(result.prompt).toContain('content');
    expect(result.prompt).toContain('endingHook');
    expect(result.prompt).toContain('wordCount');
  });
});
