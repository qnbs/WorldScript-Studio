import { describe, expect, it } from 'vitest';
import { buildScenarioWorkspaceProjection } from '../../services/scenarioWorkspaceProjection';
import type { StoryProject } from '../../types';

const project: StoryProject = {
  title: 'Pilot',
  logline: 'A test logline',
  characters: [{ id: 'c1', name: 'A' }] as unknown as StoryProject['characters'],
  worlds: [{ id: 'w1', name: 'World' }] as unknown as StoryProject['worlds'],
  outline: [{ id: 'o1', title: 'Act I', description: '', isTwist: false }],
  manuscript: [
    { id: 's1', title: 'Opening', content: 'one \n two\tthree', summary: 'The opening.' },
    { id: 's2', title: 'Interlude', content: ' \n\t', notes: 'Fallback note' },
  ],
};

describe('buildScenarioWorkspaceProjection', () => {
  it('projects canonical entities and manuscript metrics without creating new state', () => {
    // QNBS-v3: Verify projection is read-only over canonical state and creates no second store.
    const before = structuredClone(project);
    const projection = buildScenarioWorkspaceProjection(project);
    expect(projection).toEqual({
      title: 'Pilot',
      logline: 'A test logline',
      counts: { characters: 1, worlds: 1, outline: 1, scenes: 2, words: 3 },
      sections: [
        { id: 's1', title: 'Opening', summary: 'The opening.' },
        { id: 's2', title: 'Interlude', summary: 'Fallback note' },
      ],
    });
    expect(project).toEqual(before);
  });

  it('supports normalized entity collections and projects an empty outline safely', () => {
    // QNBS-v3: Keep Scenario compatible with canonical Redux entity adapters and sparse projects.
    const normalizedProject = {
      ...project,
      characters: { ids: ['c1', 'c2'], entities: {} },
      worlds: { ids: ['w1', 'w2', 'w3'], entities: {} },
      outline: undefined,
      manuscript: [],
    } as unknown as StoryProject;

    expect(buildScenarioWorkspaceProjection(normalizedProject)).toEqual({
      title: 'Pilot',
      logline: 'A test logline',
      counts: { characters: 2, worlds: 3, outline: 0, scenes: 0, words: 0 },
      sections: [],
    });
  });
});
