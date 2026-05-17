import { describe, expect, it } from 'vitest';
import {
  READABILITY_SAMPLE_MAX_CHARS,
  sampleManuscriptPlainText,
} from '../../services/manuscriptMetricsSampling';
import type { StorySection } from '../../types';

function makeSection(id: string, content: string): StorySection {
  return {
    id,
    title: `Section ${id}`,
    content,
    wordCount: content.split(' ').length,
  } as unknown as StorySection;
}

describe('READABILITY_SAMPLE_MAX_CHARS', () => {
  it('is 65 536', () => {
    expect(READABILITY_SAMPLE_MAX_CHARS).toBe(65_536);
  });
});

describe('sampleManuscriptPlainText', () => {
  it('returns empty string for empty sections array', () => {
    expect(sampleManuscriptPlainText([])).toBe('');
  });

  it('returns empty string when all sections have no content', () => {
    const sections = [makeSection('1', ''), makeSection('2', '')];
    expect(sampleManuscriptPlainText(sections)).toBe('');
  });

  it('concatenates content from multiple sections with double newline', () => {
    const sections = [makeSection('1', 'Hello world'), makeSection('2', 'Second paragraph')];
    const result = sampleManuscriptPlainText(sections);
    expect(result).toBe('Hello world\n\nSecond paragraph');
  });

  it('skips sections with empty content', () => {
    const sections = [makeSection('1', 'First'), makeSection('2', ''), makeSection('3', 'Third')];
    const result = sampleManuscriptPlainText(sections);
    expect(result).toBe('First\n\nThird');
  });

  it('respects the maxChars limit and truncates', () => {
    const sections = [makeSection('1', 'a'.repeat(100))];
    const result = sampleManuscriptPlainText(sections, 20);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('does not add a leading separator for the first section', () => {
    const sections = [makeSection('1', 'First')];
    expect(sampleManuscriptPlainText(sections)).toBe('First');
  });

  it('stops accumulating once maxChars is reached', () => {
    const long = 'x'.repeat(READABILITY_SAMPLE_MAX_CHARS + 100);
    const sections = [makeSection('1', long), makeSection('2', 'Should not appear')];
    const result = sampleManuscriptPlainText(sections);
    expect(result).not.toContain('Should not appear');
    expect(result.length).toBeLessThanOrEqual(READABILITY_SAMPLE_MAX_CHARS);
  });

  it('handles sections where content is undefined', () => {
    const sections = [{ id: '1', title: 'No content' } as unknown as StorySection];
    // content ?? '' → empty string → skipped
    expect(sampleManuscriptPlainText(sections)).toBe('');
  });
});
