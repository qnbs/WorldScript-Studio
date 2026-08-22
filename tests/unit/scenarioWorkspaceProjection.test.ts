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
    { id: 's1', title: 'Opening', content: 'one two three', summary: 'The opening.' },
  ],
};

describe('buildScenarioWorkspaceProjection', () => {
  it('projects canonical entities and manuscript metrics without creating new state', () => {
    expect(buildScenarioWorkspaceProjection(project)).toEqual({
      title: 'Pilot',
      logline: 'A test logline',
      counts: { characters: 1, worlds: 1, outline: 1, scenes: 1, words: 3 },
      sections: [{ id: 's1', title: 'Opening', summary: 'The opening.' }],
    });
  });
});