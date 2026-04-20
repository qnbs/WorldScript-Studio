import { configureStore } from '@reduxjs/toolkit';
import undoable, { type StateWithHistory } from 'redux-undo';
import { describe, expect, it } from 'vitest';
import type { RootState } from '../../app/store';
import featureFlagsReducer from '../../features/featureFlags/featureFlagsSlice';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectCanRedo,
  selectCanUndo,
  selectCharactersForGraph,
  selectManuscript,
  selectOutline,
  selectProjectGoals,
  selectRelationships,
  selectTotalWordCount,
  selectWritingHistory,
} from '../../features/project/projectSelectors';
import type { ProjectData } from '../../features/project/projectSlice';
import projectReducer, {
  charactersAdapter,
  worldsAdapter,
} from '../../features/project/projectSlice';
import settingsReducer from '../../features/settings/settingsSlice';
import statusReducer from '../../features/status/statusSlice';
import versionControlReducer from '../../features/versionControl/versionControlSlice';
import writerReducer from '../../features/writer/writerSlice';

const makeChar = (id: string, name: string) => ({
  id,
  name,
  role: 'protagonist' as const,
  description: '',
  traits: [],
  backstory: '',
});

const makeWorld = (id: string, name: string) => ({
  id,
  name,
  description: '',
  history: '',
  geography: '',
  culture: '',
  magic: '',
  technology: '',
});

function buildState(override: Partial<ProjectData> = {}): RootState {
  const data: ProjectData = {
    title: 'Test',
    logline: '',
    characters: charactersAdapter.getInitialState(),
    worlds: worldsAdapter.getInitialState(),
    outline: [],
    manuscript: [],
    projectGoals: { totalWordCount: 50000, targetDate: null },
    writingHistory: [],
    ...override,
  };

  const store = configureStore({
    reducer: {
      project: undoable(projectReducer, { limit: 100 }),
      settings: settingsReducer,
      status: statusReducer,
      writer: writerReducer,
      versionControl: versionControlReducer,
      featureFlags: featureFlagsReducer,
    },
    preloadedState: {
      project: {
        past: [],
        present: { data },
        future: [],
        group: null,
        _latestUnfiltered: { data },
        index: 0,
        limit: 100,
      } as unknown as StateWithHistory<{ data: ProjectData }>,
    },
  });
  return store.getState() as RootState;
}

describe('undo/redo selectors', () => {
  it('selectCanUndo is false when past is empty', () => {
    expect(selectCanUndo(buildState())).toBe(false);
  });

  it('selectCanRedo is false when future is empty', () => {
    expect(selectCanRedo(buildState())).toBe(false);
  });
});

describe('manuscript selectors', () => {
  it('selectManuscript returns empty array by default', () => {
    expect(selectManuscript(buildState())).toEqual([]);
  });

  it('selectManuscript returns sections', () => {
    const manuscript = [{ id: 's1', title: 'Ch1', content: 'hello world' }];
    expect(selectManuscript(buildState({ manuscript }))).toEqual(manuscript);
  });
});

describe('selectTotalWordCount', () => {
  it('counts words across all sections', () => {
    const manuscript = [
      { id: 's1', title: 'Ch1', content: 'hello world' },
      { id: 's2', title: 'Ch2', content: 'one two three' },
    ];
    expect(selectTotalWordCount(buildState({ manuscript }))).toBe(5);
  });

  it('returns 0 for empty manuscript', () => {
    expect(selectTotalWordCount(buildState())).toBe(0);
  });
});

describe('selectOutline', () => {
  it('returns empty array by default', () => {
    expect(selectOutline(buildState())).toEqual([]);
  });
});

describe('selectWritingHistory', () => {
  it('returns empty array by default', () => {
    expect(selectWritingHistory(buildState())).toEqual([]);
  });
});

describe('selectProjectGoals', () => {
  it('returns default goals', () => {
    expect(selectProjectGoals(buildState())).toEqual({
      totalWordCount: 50000,
      targetDate: null,
    });
  });
});

describe('character selectors', () => {
  it('selectAllCharacters returns empty array by default', () => {
    expect(selectAllCharacters(buildState())).toEqual([]);
  });

  it('selectAllCharacters returns added characters', () => {
    const characters = charactersAdapter.addMany(charactersAdapter.getInitialState(), [
      makeChar('c1', 'Alice'),
      makeChar('c2', 'Bob'),
    ]);
    const state = buildState({ characters });
    expect(selectAllCharacters(state)).toHaveLength(2);
    expect(selectAllCharacters(state)[0].name).toBe('Alice');
  });
});

describe('world selectors', () => {
  it('selectAllWorlds returns empty array by default', () => {
    expect(selectAllWorlds(buildState())).toEqual([]);
  });

  it('selectAllWorlds returns added worlds', () => {
    const worlds = worldsAdapter.addMany(worldsAdapter.getInitialState(), [
      makeWorld('w1', 'Middle Earth'),
    ]);
    expect(selectAllWorlds(buildState({ worlds }))).toHaveLength(1);
  });
});

describe('selectRelationships', () => {
  it('returns empty array by default', () => {
    expect(selectRelationships(buildState())).toEqual([]);
  });
});

describe('selectCharactersForGraph', () => {
  it('returns characters and relationships together', () => {
    const result = selectCharactersForGraph(buildState());
    expect(result).toHaveProperty('characters');
    expect(result).toHaveProperty('relationships');
  });
});
