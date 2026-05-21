import { describe, expect, it } from 'vitest';
import {
  getAllTemplates,
  getQuestionsForArchetype,
  getTemplateForArchetype,
} from '../../services/characterInterviewTemplates';

describe('characterInterviewTemplates', () => {
  it('getAllTemplates returns 9 templates', () => {
    expect(getAllTemplates()).toHaveLength(9);
  });

  it('every template has at least 5 questions', () => {
    for (const tmpl of getAllTemplates()) {
      expect(tmpl.questions.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('getTemplateForArchetype returns template for hero', () => {
    const tmpl = getTemplateForArchetype('hero');
    expect(tmpl).toBeDefined();
    expect(tmpl?.archetype).toBe('hero');
    expect(tmpl?.questions.length).toBeGreaterThanOrEqual(5);
  });

  it('getTemplateForArchetype returns undefined for unknown archetype', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test boundary
    expect(getTemplateForArchetype('unknown' as any)).toBeUndefined();
  });

  it('getQuestionsForArchetype returns questions array for villain', () => {
    const qs = getQuestionsForArchetype('villain');
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q).toHaveProperty('id');
      expect(q).toHaveProperty('question');
    }
  });

  it('getQuestionsForArchetype returns empty array for unknown archetype', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test boundary
    expect(getQuestionsForArchetype('unknown' as any)).toHaveLength(0);
  });
});
