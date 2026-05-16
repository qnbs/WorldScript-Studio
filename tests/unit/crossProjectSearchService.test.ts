import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../features/project/projectSlice';
import { searchAcrossProjects } from '../../services/crossProjectSearchService';
import type { Character } from '../../types';

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    name: 'Hero',
    backstory: '',
    motivation: '',
    appearance: '',
    personalityTraits: '',
    flaws: '',
    notes: '',
    characterArc: '',
    relationships: '',
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    title: 'Test Project',
    logline: 'A story about testing',
    characters: { ids: [], entities: {} },
    worlds: { ids: [], entities: {} },
    outline: [],
    manuscript: [],
    ...overrides,
  };
}

describe('searchAcrossProjects', () => {
  it('returns empty array when query is empty', () => {
    expect(searchAcrossProjects('', makeProject())).toEqual([]);
  });

  it('returns empty array when query does not match anything', () => {
    const data = makeProject({ title: 'Dragon Saga', logline: 'Dragons fly' });
    expect(searchAcrossProjects('zzzzxxx', data)).toEqual([]);
  });

  it('matches project title', () => {
    const data = makeProject({ title: 'Dragon Saga' });
    const results = searchAcrossProjects('dragon', data);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.matchType === 'title')).toBe(true);
  });

  it('matches project logline', () => {
    const data = makeProject({ logline: 'A knight fights dragons in a dark forest' });
    const results = searchAcrossProjects('knight', data);
    expect(results.some((r) => r.matchType === 'logline')).toBe(true);
  });

  it('skips logline match when logline is empty', () => {
    const data = makeProject({ logline: '' });
    const results = searchAcrossProjects('knight', data);
    expect(results.every((r) => r.matchType !== 'logline')).toBe(true);
  });

  it('matches manuscript section by content', () => {
    const data = makeProject({
      manuscript: [{ id: 's1', title: 'Chapter 1', content: 'The hero arrives in the city' }],
    });
    const results = searchAcrossProjects('hero', data);
    expect(results.some((r) => r.matchType === 'manuscript')).toBe(true);
  });

  it('uses title as excerpt when section content is empty', () => {
    const data = makeProject({
      manuscript: [{ id: 's1', title: 'Prologue', content: '' }],
    });
    const results = searchAcrossProjects('prologue', data);
    const match = results.find((r) => r.matchType === 'manuscript');
    expect(match?.excerpt).toBe('Prologue');
  });

  it('truncates long excerpt to ~120 chars', () => {
    const longContent = 'hero '.repeat(50); // 250 chars
    const data = makeProject({
      manuscript: [{ id: 's1', title: 'Ch', content: longContent }],
    });
    const results = searchAcrossProjects('hero', data);
    const match = results.find((r) => r.matchType === 'manuscript');
    expect(match?.excerpt.length).toBeLessThanOrEqual(121);
    expect(match?.excerpt).toMatch(/…$/);
  });

  it('matches character name (EntityState format)', () => {
    const char = makeCharacter({ id: 'c1', name: 'Merlin' });
    const data = makeProject({
      characters: { ids: ['c1'], entities: { c1: char } },
    });
    const results = searchAcrossProjects('merlin', data);
    expect(results.some((r) => r.matchType === 'character')).toBe(true);
    expect(results.find((r) => r.matchType === 'character')?.excerpt).toBe('Merlin');
  });

  it('matches character backstory text', () => {
    const char = makeCharacter({
      id: 'c1',
      name: 'Elena',
      backstory: 'She was raised by wolves in the north',
    });
    const data = makeProject({
      characters: { ids: ['c1'], entities: { c1: char } },
    });
    const results = searchAcrossProjects('wolves', data);
    expect(results.some((r) => r.matchType === 'character')).toBe(true);
  });

  it('sorts results by score descending', () => {
    const data = makeProject({
      title: 'Hero Quest',
      logline: 'hero finds the magic sword',
      manuscript: [{ id: 's1', title: 'hero chapter', content: 'hero sets out on a journey' }],
    });
    const results = searchAcrossProjects('hero', data);
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('includes projectId and projectTitle in every result', () => {
    const data2 = makeProject({ id: 'proj-42', title: 'Test Novel' });
    const results2 = searchAcrossProjects('test', data2);
    expect(results2[0]?.projectId).toBe('proj-42');
    expect(results2[0]?.projectTitle).toBe('Test Novel');
  });

  it('falls back to "current" when projectData has no id', () => {
    const data = makeProject({ title: 'Test Story' });
    const results = searchAcrossProjects('test', data);
    expect(results[0]?.projectId).toBe('current');
  });
});
