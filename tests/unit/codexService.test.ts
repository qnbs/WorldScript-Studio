import { describe, expect, it, vi } from 'vitest';
import { extractStoryCodex } from '../../services/codexService';

// Mock dbService to avoid IndexedDB dependency
vi.mock('../../services/dbService', () => ({
  dbService: {
    saveStoryCodex: vi.fn(),
  },
}));

describe('extractStoryCodex', () => {
  const makeSection = (content: string, title = 'Chapter 1') => ({
    id: 'section-1',
    title,
    content,
  });

  it('completes without infinite loop on stopword-heavy text', () => {
    const start = performance.now();
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('The dragon flew over The castle. The sun set behind The mountains.')],
      [],
      [],
    );
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(codex.projectId).toBe('test-project');
  });

  it('extracts proper nouns that are not stopwords', () => {
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('Alexander walked through Winterfell. He met Gandalf near the old bridge.')],
      [],
      [],
    );

    const names = codex.entities.map((e) => e.name);
    expect(names).toContain('Alexander');
    expect(names).toContain('Winterfell');
    expect(names).toContain('Gandalf');
  });

  it('skips stopwords like The, And, But', () => {
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('The And But Or Nor Yet So From With Without')],
      [],
      [],
    );

    const names = codex.entities.map((e) => e.name);
    expect(names).not.toContain('The');
    expect(names).not.toContain('And');
    expect(names).not.toContain('But');
  });

  it('skips candidates shorter than 3 characters', () => {
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('Al walked to Bo near the river.')],
      [],
      [],
    );

    const names = codex.entities.map((e) => e.name);
    expect(names).not.toContain('Al');
    expect(names).not.toContain('Bo');
  });

  it('tracks known characters with correct type', () => {
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('Elena spoke to Marcus about the plan.')],
      [
        {
          id: 'char-1',
          name: 'Elena',
          backstory: '',
          motivation: '',
          appearance: '',
          personalityTraits: '',
          flaws: '',
          notes: '',
          characterArc: '',
          relationships: '',
        },
        {
          id: 'char-2',
          name: 'Marcus',
          backstory: '',
          motivation: '',
          appearance: '',
          personalityTraits: '',
          flaws: '',
          notes: '',
          characterArc: '',
          relationships: '',
        },
      ],
      [],
    );

    const elena = codex.entities.find((e) => e.name === 'Elena');
    expect(elena).toBeDefined();
    expect(elena?.type).toBe('character');
    expect(elena?.known).toBe(true);
    expect(elena?.mentionCount).toBeGreaterThanOrEqual(1);
  });

  it('tracks known worlds with correct type', () => {
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('They arrived at Eldoria, a vast kingdom.')],
      [],
      [
        {
          id: 'world-1',
          name: 'Eldoria',
          description: '',
          geography: '',
          culture: '',
          magicSystem: '',
          notes: '',
          timeline: [],
          locations: [],
        },
      ],
    );

    const eldoria = codex.entities.find((e) => e.name === 'Eldoria');
    expect(eldoria).toBeDefined();
    expect(eldoria?.type).toBe('world');
    expect(eldoria?.known).toBe(true);
  });

  it('returns known entities even when not mentioned in manuscript', () => {
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('No character names here.')],
      [
        {
          id: 'char-1',
          name: 'Isolde',
          backstory: '',
          motivation: '',
          appearance: '',
          personalityTraits: '',
          flaws: '',
          notes: '',
          characterArc: '',
          relationships: '',
        },
      ],
      [],
    );

    const isolde = codex.entities.find((e) => e.name === 'Isolde');
    expect(isolde).toBeDefined();
    expect(isolde?.mentionCount).toBe(0);
  });

  it('generates a summary from top entities', () => {
    const codex = extractStoryCodex(
      'test-project',
      [makeSection('Alexander met Isabella. Alexander greeted Isabella warmly.')],
      [],
      [],
    );

    expect(codex.summary).toContain('Alexander');
    expect(codex.summary).toContain('Isabella');
  });
});
