/**
 * Tests for services/crossProjectSearchService.ts
 * QNBS-v3: Pure functions — searchAcrossProjects and searchAcrossProjectIndex.
 */

import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../../features/project/projectSlice';
import type { ProjectSearchIndex } from '../../../services/crossProjectIndexService';
import {
  searchAcrossProjectIndex,
  searchAcrossProjects,
} from '../../../services/crossProjectSearchService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProjectData(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    id: 'p1',
    title: 'The Dragon Chronicles',
    logline: 'A young hero discovers a hidden dragon realm',
    manuscript: [
      {
        id: 's1',
        title: 'Chapter One',
        content: 'It began on a stormy night in the city of Ashford.',
        wordCount: 9,
        type: 'scene',
        order: 0,
        act: 1,
      } as never,
    ],
    characters: [
      {
        id: 'c1',
        name: 'Elena Ashford',
        archetype: 'hero',
        backstory: 'A brave warrior',
        motivation: 'Protect the realm',
      },
    ] as never,
    worlds: [],
    outline: [],
    ...overrides,
  } as ProjectData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchAcrossProjects', () => {
  it('returns empty array for empty query', () => {
    expect(searchAcrossProjects('', makeProjectData())).toHaveLength(0);
  });

  it('returns empty array for whitespace query', () => {
    expect(searchAcrossProjects('   ', makeProjectData())).toHaveLength(0);
  });

  it('matches project title', () => {
    const results = searchAcrossProjects('Dragon', makeProjectData());
    expect(results.some((r) => r.matchType === 'title')).toBe(true);
  });

  it('matches logline', () => {
    const results = searchAcrossProjects('hero', makeProjectData());
    expect(results.some((r) => r.matchType === 'logline')).toBe(true);
  });

  it('matches manuscript content', () => {
    const results = searchAcrossProjects('Ashford', makeProjectData());
    expect(results.some((r) => r.matchType === 'manuscript')).toBe(true);
  });

  it('matches character name', () => {
    const results = searchAcrossProjects('Elena', makeProjectData());
    expect(results.some((r) => r.matchType === 'character')).toBe(true);
  });

  it('returns results sorted by score descending', () => {
    const results = searchAcrossProjects('dragon', makeProjectData());
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('does not match for unrelated query', () => {
    expect(searchAcrossProjects('xyzzy_not_in_data', makeProjectData())).toHaveLength(0);
  });

  it('returns projectId and projectTitle on each result', () => {
    const results = searchAcrossProjects('Dragon', makeProjectData());
    for (const r of results) {
      expect(r.projectId).toBe('p1');
      expect(r.projectTitle).toBe('The Dragon Chronicles');
    }
  });

  it('handles array-style characters (not entity adapter)', () => {
    const data = makeProjectData({
      characters: [{ id: 'c1', name: 'Zorba the Great', archetype: 'villain' }] as never,
    });
    const results = searchAcrossProjects('Zorba', data);
    expect(results.some((r) => r.matchType === 'character')).toBe(true);
  });
});

describe('searchAcrossProjectIndex', () => {
  const indexes: ProjectSearchIndex[] = [
    {
      projectId: 'p1',
      title: 'The Dragon Chronicles',
      logline: 'A young hero',
      characterNames: ['Elena'],
      manuscriptWordCount: 1000,
      lastIndexed: Date.now(),
    },
    {
      projectId: 'p2',
      title: 'Space Odyssey',
      logline: 'Astronauts explore',
      characterNames: ['Dave'],
      manuscriptWordCount: 2000,
      lastIndexed: Date.now(),
    },
  ];

  it('returns empty for empty query', () => {
    expect(searchAcrossProjectIndex('', indexes)).toHaveLength(0);
  });

  it('returns empty for empty indexes', () => {
    expect(searchAcrossProjectIndex('dragon', [])).toHaveLength(0);
  });

  it('matches title in index', () => {
    const results = searchAcrossProjectIndex('dragon', indexes);
    expect(results.some((r) => r.projectId === 'p1' && r.matchType === 'title')).toBe(true);
  });

  it('matches logline in index', () => {
    const results = searchAcrossProjectIndex('hero', indexes);
    expect(results.some((r) => r.matchType === 'logline')).toBe(true);
  });

  it('does not match unrelated query', () => {
    expect(searchAcrossProjectIndex('xyz_not_found', indexes)).toHaveLength(0);
  });
});
