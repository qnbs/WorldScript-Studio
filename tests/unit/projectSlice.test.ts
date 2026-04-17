import type { AnyAction } from '@reduxjs/toolkit';
import { configureStore } from '@reduxjs/toolkit';
import undoable, { type StateWithHistory } from 'redux-undo';
import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../features/project/projectSlice';
import projectReducer, {
  charactersAdapter,
  projectActions,
  worldsAdapter,
} from '../../features/project/projectSlice';

// Helper to create a test store with proper structure
function createTestStore(preloadedProjectData?: Partial<ProjectData>) {
  const defaultData: ProjectData = {
    title: 'Test Story',
    logline: 'A test logline',
    characters: charactersAdapter.getInitialState(),
    worlds: worldsAdapter.getInitialState(),
    outline: [],
    manuscript: [{ id: 'sec-1', title: 'Chapter 1', content: '' }],
    projectGoals: { totalWordCount: 50000, targetDate: null },
    writingHistory: [],
  };

  return configureStore({
    reducer: {
      project: undoable(projectReducer, { limit: 100 }),
    },
    preloadedState: {
      project: {
        past: [],
        present: { data: { ...defaultData, ...preloadedProjectData } },
        future: [],
        group: null,
        _latestUnfiltered: { data: { ...defaultData, ...preloadedProjectData } },
        index: 0,
        limit: 100,
      } as unknown as StateWithHistory<{ data: ProjectData }>,
    },
  });
}

describe('projectSlice', () => {
  describe('reducers', () => {
    it('should update title', () => {
      const store = createTestStore();
      store.dispatch(projectActions.updateTitle('New Title'));
      expect(store.getState().project.present.data.title).toBe('New Title');
    });

    it('should update logline', () => {
      const store = createTestStore();
      store.dispatch(projectActions.updateLogline('New Logline'));
      expect(store.getState().project.present.data.logline).toBe('New Logline');
    });

    it('should add a character', () => {
      const store = createTestStore();
      store.dispatch(projectActions.addCharacter({ name: 'Hero' }));
      const chars = store.getState().project.present.data.characters;
      expect(chars.ids.length).toBe(1);
      const charId = chars.ids[0] as string;
      expect(chars.entities[charId]?.name).toBe('Hero');
    });

    it('should update a character', () => {
      const store = createTestStore();
      store.dispatch(projectActions.addCharacter({ name: 'Hero' }));
      const id = store.getState().project.present.data.characters.ids[0] as string;
      store.dispatch(
        projectActions.updateCharacter({ id, changes: { backstory: 'Born in shadows' } }),
      );
      expect(store.getState().project.present.data.characters.entities[id]?.backstory).toBe(
        'Born in shadows',
      );
    });

    it('should delete a character', () => {
      const store = createTestStore();
      store.dispatch(projectActions.addCharacter({ name: 'Hero' }));
      const id = store.getState().project.present.data.characters.ids[0] as string;
      store.dispatch(projectActions.deleteCharacter(id));
      expect(store.getState().project.present.data.characters.ids.length).toBe(0);
    });

    it('should add a world', () => {
      const store = createTestStore();
      store.dispatch(projectActions.addWorld({ name: 'Middle Earth' }));
      const worlds = store.getState().project.present.data.worlds;
      expect(worlds.ids.length).toBe(1);
      const worldId = worlds.ids[0] as string;
      expect(worlds.entities[worldId]?.name).toBe('Middle Earth');
    });

    it('should set outline', () => {
      const store = createTestStore();
      const outline = [
        { id: '1', title: 'Act 1', description: 'The beginning' },
        { id: '2', title: 'Act 2', description: 'The middle' },
      ];
      store.dispatch(projectActions.setOutline(outline));
      expect(store.getState().project.present.data.outline).toEqual(outline);
    });

    it('should add manuscript section', () => {
      const store = createTestStore();
      store.dispatch(projectActions.addManuscriptSection({ title: 'Chapter 2' }));
      expect(store.getState().project.present.data.manuscript.length).toBe(2);
    });

    it('should update manuscript section', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.updateManuscriptSection({
          id: 'sec-1',
          changes: { content: 'Once upon a time...' },
        }),
      );
      const manuscript = store.getState().project.present.data.manuscript;
      expect(manuscript[0]?.content).toBe('Once upon a time...');
    });

    it('should delete manuscript section', () => {
      const store = createTestStore();
      store.dispatch(projectActions.deleteManuscriptSection('sec-1'));
      expect(store.getState().project.present.data.manuscript.length).toBe(0);
    });

    it('should reset project with new title/logline', () => {
      const store = createTestStore({ title: 'Old', logline: 'Old logline' });
      store.dispatch(projectActions.resetProject({ title: 'Fresh', logline: 'A fresh start' }));
      const data = store.getState().project.present.data;
      expect(data.title).toBe('Fresh');
      expect(data.logline).toBe('A fresh start');
      expect(data.characters.ids.length).toBe(0);
    });

    it('should add and manage relationships', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addRelationship({
          id: 'rel-1',
          fromCharacterId: 'a',
          toCharacterId: 'b',
          type: 'friend',
          strength: 5,
        }),
      );
      expect(store.getState().project.present.data.relationships?.length).toBe(1);

      store.dispatch(
        projectActions.updateRelationship({
          id: 'rel-1',
          changes: { strength: 8 },
        }),
      );
      const relationships = store.getState().project.present.data.relationships;
      expect(relationships?.[0]?.strength).toBe(8);

      store.dispatch(projectActions.deleteRelationship('rel-1'));
      expect(store.getState().project.present.data.relationships?.length).toBe(0);
    });

    it('should update project goals', () => {
      const store = createTestStore();
      store.dispatch(projectActions.updateProjectGoal({ key: 'totalWordCount', value: 80000 }));
      expect(store.getState().project.present.data.projectGoals?.totalWordCount).toBe(80000);
    });
  });

  describe('undo/redo', () => {
    it('should support undo/redo for synchronous actions', () => {
      const store = createTestStore();
      store.dispatch(projectActions.updateTitle('Version 1'));
      store.dispatch(projectActions.updateTitle('Version 2'));

      expect(store.getState().project.present.data.title).toBe('Version 2');
      expect(store.getState().project.past.length).toBe(2); // initial + Version 1

      // Undo
      store.dispatch({ type: '@@redux-undo/UNDO' } as AnyAction);
      expect(store.getState().project.present.data.title).toBe('Version 1');

      // Redo
      store.dispatch({ type: '@@redux-undo/REDO' } as AnyAction);
      expect(store.getState().project.present.data.title).toBe('Version 2');
    });
  });
});
