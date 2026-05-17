import { describe, expect, it } from 'vitest';
import { partialStorySectionFromSnapshot } from '../../features/project/sectionRestoreHelpers';
import type { StorySection } from '../../types';

// QNBS-v3: Allow undefined values explicitly for exactOptionalPropertyTypes tests
function makeSection(
  overrides: { [K in keyof StorySection]?: StorySection[K] | undefined } = {},
): StorySection {
  return {
    id: 's1',
    title: 'Chapter One',
    content: 'Once upon a time.',
    wordCount: 4,
    ...overrides,
  } as StorySection;
}

describe('partialStorySectionFromSnapshot', () => {
  it('always includes title and content', () => {
    const result = partialStorySectionFromSnapshot(makeSection());
    expect(result.title).toBe('Chapter One');
    expect(result.content).toBe('Once upon a time.');
  });

  it('includes summary when defined', () => {
    const result = partialStorySectionFromSnapshot(makeSection({ summary: 'A brief summary.' }));
    expect(result.summary).toBe('A brief summary.');
  });

  it('omits summary key when undefined', () => {
    const result = partialStorySectionFromSnapshot(makeSection({ summary: undefined }));
    expect(Object.hasOwn(result, 'summary')).toBe(false);
  });

  it('includes notes when defined', () => {
    const result = partialStorySectionFromSnapshot(makeSection({ notes: 'My notes.' }));
    expect(result.notes).toBe('My notes.');
  });

  it('omits notes key when undefined', () => {
    const result = partialStorySectionFromSnapshot(makeSection({ notes: undefined }));
    expect(Object.hasOwn(result, 'notes')).toBe(false);
  });

  it('includes prompt when defined', () => {
    const result = partialStorySectionFromSnapshot(makeSection({ prompt: 'Write more.' }));
    expect(result.prompt).toBe('Write more.');
  });

  it('omits prompt key when undefined', () => {
    const result = partialStorySectionFromSnapshot(makeSection({ prompt: undefined }));
    expect(Object.hasOwn(result, 'prompt')).toBe(false);
  });

  it('does not include id or wordCount in the partial', () => {
    const result = partialStorySectionFromSnapshot(makeSection());
    expect(Object.hasOwn(result, 'id')).toBe(false);
    expect(Object.hasOwn(result, 'wordCount')).toBe(false);
  });
});
