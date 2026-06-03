import { describe, expect, it } from 'vitest';
import {
  characterCompleteness,
  filterByQuery,
  sortByMode,
  worldCompleteness,
} from '../../services/rosterMetrics';
import type { Character, World } from '../../types';

const emptyCharacter = (over: Partial<Character> = {}): Character => ({
  id: 'c1',
  name: 'Nobody',
  backstory: '',
  motivation: '',
  appearance: '',
  personalityTraits: '',
  flaws: '',
  notes: '',
  characterArc: '',
  relationships: '',
  hasAvatar: false,
  ...over,
});

const emptyWorld = (over: Partial<World> = {}): World => ({
  id: 'w1',
  name: 'Void',
  description: '',
  geography: '',
  magicSystem: '',
  culture: '',
  notes: '',
  hasAmbianceImage: false,
  timeline: [],
  locations: [],
  ...over,
});

describe('characterCompleteness', () => {
  it('is 0 for a blank character', () => {
    expect(characterCompleteness(emptyCharacter())).toBe(0);
  });

  it('is 100 for a fully filled character', () => {
    expect(
      characterCompleteness(
        emptyCharacter({
          backstory: 'a',
          motivation: 'a',
          appearance: 'a',
          personalityTraits: 'a',
          flaws: 'a',
          characterArc: 'a',
          relationships: 'a',
          notes: 'a',
          hasAvatar: true,
        }),
      ),
    ).toBe(100);
  });

  it('ignores whitespace-only fields', () => {
    expect(characterCompleteness(emptyCharacter({ backstory: '   ' }))).toBe(0);
  });

  it('scales partially (1 of 9 ≈ 11%)', () => {
    expect(characterCompleteness(emptyCharacter({ motivation: 'driven' }))).toBe(11);
  });
});

describe('worldCompleteness', () => {
  it('is 0 for a blank world', () => {
    expect(worldCompleteness(emptyWorld())).toBe(0);
  });

  it('is 100 when every signal is present', () => {
    expect(
      worldCompleteness(
        emptyWorld({
          description: 'a',
          geography: 'a',
          magicSystem: 'a',
          culture: 'a',
          notes: 'a',
          hasAmbianceImage: true,
          timeline: [{ id: 't1', era: 'Age', title: 'Founding', description: 'event' }],
          locations: [{ id: 'l1', name: 'Keep', description: 'a fort', type: 'castle' }],
        }),
      ),
    ).toBe(100);
  });

  it('counts timeline and locations as signals', () => {
    const w = emptyWorld({ timeline: [{ id: 't1', era: 'x', title: 'z', description: 'y' }] });
    expect(worldCompleteness(w)).toBe(13); // 1 of 8
  });
});

describe('filterByQuery', () => {
  const items = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'alfred' }];

  it('returns a copy for an empty query', () => {
    const out = filterByQuery(items, '   ', (i) => i.name);
    expect(out).toHaveLength(3);
    expect(out).not.toBe(items);
  });

  it('filters case-insensitively by substring', () => {
    expect(filterByQuery(items, 'al', (i) => i.name).map((i) => i.name)).toEqual([
      'Alice',
      'alfred',
    ]);
  });
});

describe('sortByMode', () => {
  const items = [
    { name: 'Bob', score: 80 },
    { name: 'Alice', score: 20 },
    { name: 'Cara', score: 50 },
  ];
  const name = (i: { name: string }) => i.name;
  const score = (i: { score: number }) => i.score;

  it('sorts name ascending', () => {
    expect(sortByMode(items, 'name-asc', name, score).map(name)).toEqual(['Alice', 'Bob', 'Cara']);
  });

  it('sorts name descending', () => {
    expect(sortByMode(items, 'name-desc', name, score).map(name)).toEqual(['Cara', 'Bob', 'Alice']);
  });

  it('sorts completeness descending', () => {
    expect(sortByMode(items, 'complete-desc', name, score).map(name)).toEqual([
      'Bob',
      'Cara',
      'Alice',
    ]);
  });

  it('does not mutate the input array', () => {
    const copy = [...items];
    sortByMode(items, 'name-asc', name, score);
    expect(items).toEqual(copy);
  });
});
