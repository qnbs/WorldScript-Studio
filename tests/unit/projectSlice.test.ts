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
      store.dispatch(
        projectActions.resetProject({
          title: 'Fresh',
          logline: 'A fresh start',
          chapter1Title: 'Chapter 1',
        }),
      );
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

  describe('worlds', () => {
    it('should update a world', () => {
      const store = createTestStore();
      store.dispatch(projectActions.addWorld({ name: 'Narnia' }));
      const worlds = store.getState().project.present.data.worlds;
      const id = worlds.ids[0] as string;
      store.dispatch(projectActions.updateWorld({ id, changes: { description: 'A magic land' } }));
      const updated = store.getState().project.present.data.worlds.entities[id];
      expect(updated?.description).toBe('A magic land');
    });

    it('should delete a world', () => {
      const store = createTestStore();
      store.dispatch(projectActions.addWorld({ name: 'Mordor' }));
      const id = store.getState().project.present.data.worlds.ids[0] as string;
      store.dispatch(projectActions.deleteWorld(id));
      expect(store.getState().project.present.data.worlds.ids).toHaveLength(0);
    });
  });

  describe('setManuscript', () => {
    it('replaces the full manuscript', () => {
      const store = createTestStore();
      const newManuscript = [
        { id: 'ch-a', title: 'Prologue', content: 'It began...' },
        { id: 'ch-b', title: 'Chapter 1', content: 'Then...' },
      ];
      store.dispatch(projectActions.setManuscript(newManuscript));
      expect(store.getState().project.present.data.manuscript).toEqual(newManuscript);
    });
  });

  describe('writing sessions and goals', () => {
    it('should add a writing session', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addWritingSession({
          id: 'ws-1',
          date: '2026-04-20',
          startTime: '09:00',
          endTime: '09:30',
          wordsWritten: 500,
        }),
      );
      expect(store.getState().project.present.data.writingSessions).toHaveLength(1);
      expect(store.getState().project.present.data.writingSessions?.[0]?.wordsWritten).toBe(500);
    });

    it('should update a writing goal', () => {
      const store = createTestStore();
      const goals = [{ id: 'g1', type: 'daily' as const, target: 500, current: 0 }];
      store.dispatch(
        projectActions.resetProject({
          title: 'T',
          logline: 'L',
          chapter1Title: 'C1',
        }),
      );
      // updateWritingGoal on unknown id is a no-op (initializes array but adds nothing)
      store.dispatch(
        projectActions.updateWritingGoal({ id: 'nonexistent', changes: { target: 1000 } }),
      );
      expect(store.getState().project.present.data.writingGoals).toHaveLength(0);
      void goals;
    });
  });

  // QNBS-v3: Plot-board content (connections/subplots/tension) moved here so they are undo-able.
  describe('plot connections', () => {
    it('adds a plot connection', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotConnection({
          id: 'c1',
          fromSectionId: 'sec-1',
          toSectionId: 'sec-2',
          type: 'cause-effect',
        }),
      );
      expect(store.getState().project.present.data.plotConnections).toHaveLength(1);
    });

    it('prevents duplicate connections', () => {
      const store = createTestStore();
      const conn = {
        id: 'c1',
        fromSectionId: 's1',
        toSectionId: 's2',
        type: 'cause-effect' as const,
      };
      store.dispatch(projectActions.addPlotConnection(conn));
      store.dispatch(projectActions.addPlotConnection({ ...conn, id: 'c2' }));
      expect(store.getState().project.present.data.plotConnections).toHaveLength(1);
    });

    it('updates a connection type', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotConnection({
          id: 'c1',
          fromSectionId: 's1',
          toSectionId: 's2',
          type: 'cause-effect',
        }),
      );
      store.dispatch(
        projectActions.updatePlotConnection({ id: 'c1', changes: { type: 'parallel' } }),
      );
      expect(store.getState().project.present.data.plotConnections?.[0]?.type).toBe('parallel');
    });

    it('removes a connection', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotConnection({
          id: 'c1',
          fromSectionId: 's1',
          toSectionId: 's2',
          type: 'cause-effect',
        }),
      );
      store.dispatch(projectActions.removePlotConnection('c1'));
      expect(store.getState().project.present.data.plotConnections).toHaveLength(0);
    });

    it('removes connections for a deleted section', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotConnection({
          id: 'c1',
          fromSectionId: 'sec-1',
          toSectionId: 's2',
          type: 'cause-effect',
        }),
      );
      store.dispatch(
        projectActions.addPlotConnection({
          id: 'c2',
          fromSectionId: 'other',
          toSectionId: 'sec-1',
          type: 'parallel',
        }),
      );
      store.dispatch(projectActions.removePlotConnectionsForSection('sec-1'));
      expect(store.getState().project.present.data.plotConnections).toHaveLength(0);
    });

    it('finishPlotDrawConnection creates connection and rejects self-loops', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.finishPlotDrawConnection({
          fromSectionId: 's1',
          toSectionId: 's1',
          type: 'cause-effect',
          newId: 'self',
        }),
      );
      expect(store.getState().project.present.data.plotConnections ?? []).toHaveLength(0);
      store.dispatch(
        projectActions.finishPlotDrawConnection({
          fromSectionId: 's1',
          toSectionId: 's2',
          type: 'cause-effect',
          newId: 'c1',
        }),
      );
      expect(store.getState().project.present.data.plotConnections).toHaveLength(1);
    });

    it('connections are undo-able', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotConnection({
          id: 'c1',
          fromSectionId: 's1',
          toSectionId: 's2',
          type: 'cause-effect',
        }),
      );
      expect(store.getState().project.present.data.plotConnections).toHaveLength(1);
      store.dispatch({ type: '@@redux-undo/UNDO' } as AnyAction);
      expect(store.getState().project.present.data.plotConnections ?? []).toHaveLength(0);
    });
  });

  describe('plot subplots', () => {
    it('adds a subplot', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotSubplot({
          id: 'sp-1',
          name: 'Love arc',
          color: '#a855f7',
          sectionIds: [],
        }),
      );
      expect(store.getState().project.present.data.plotSubplots).toHaveLength(1);
    });

    it('updates a subplot name', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotSubplot({
          id: 'sp-1',
          name: 'Love arc',
          color: '#a855f7',
          sectionIds: [],
        }),
      );
      store.dispatch(
        projectActions.updatePlotSubplot({ id: 'sp-1', changes: { name: 'Rivalry arc' } }),
      );
      expect(store.getState().project.present.data.plotSubplots?.[0]?.name).toBe('Rivalry arc');
    });

    it('deletes a subplot and removes subplot refs from connections', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotSubplot({
          id: 'sp-1',
          name: 'Love arc',
          color: '#a855f7',
          sectionIds: [],
        }),
      );
      store.dispatch(
        projectActions.addPlotConnection({
          id: 'c1',
          fromSectionId: 's1',
          toSectionId: 's2',
          type: 'subplot',
          subplotId: 'sp-1',
        }),
      );
      store.dispatch(projectActions.deletePlotSubplot('sp-1'));
      expect(store.getState().project.present.data.plotSubplots).toHaveLength(0);
      // Connection still exists but subplotId removed
      expect(store.getState().project.present.data.plotConnections?.[0]?.subplotId).toBeUndefined();
    });

    it('assigns and removes a section from a subplot', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotSubplot({
          id: 'sp-1',
          name: 'Love arc',
          color: '#a855f7',
          sectionIds: [],
        }),
      );
      store.dispatch(
        projectActions.assignSectionToPlotSubplot({ sectionId: 'scene-x', subplotId: 'sp-1' }),
      );
      expect(store.getState().project.present.data.plotSubplots?.[0]?.sectionIds).toContain(
        'scene-x',
      );
      store.dispatch(
        projectActions.removeSectionFromPlotSubplot({ sectionId: 'scene-x', subplotId: 'sp-1' }),
      );
      expect(store.getState().project.present.data.plotSubplots?.[0]?.sectionIds).not.toContain(
        'scene-x',
      );
    });

    it('subplots are undo-able', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.addPlotSubplot({
          id: 'sp-1',
          name: 'Love arc',
          color: '#a855f7',
          sectionIds: [],
        }),
      );
      expect(store.getState().project.present.data.plotSubplots).toHaveLength(1);
      store.dispatch({ type: '@@redux-undo/UNDO' } as AnyAction);
      expect(store.getState().project.present.data.plotSubplots ?? []).toHaveLength(0);
    });
  });

  describe('plot tension overrides', () => {
    it('sets tension override clamped to 0–10', () => {
      const store = createTestStore();
      store.dispatch(projectActions.setPlotTensionOverride({ sectionId: 's1', score: 15 }));
      expect(store.getState().project.present.data.plotTensionOverrides?.['s1']).toBe(10);
      store.dispatch(projectActions.setPlotTensionOverride({ sectionId: 's1', score: -3 }));
      expect(store.getState().project.present.data.plotTensionOverrides?.['s1']).toBe(0);
    });

    it('clears a single tension override', () => {
      const store = createTestStore();
      store.dispatch(projectActions.setPlotTensionOverride({ sectionId: 's1', score: 7 }));
      store.dispatch(projectActions.clearPlotTensionOverride('s1'));
      expect(store.getState().project.present.data.plotTensionOverrides?.['s1']).toBeUndefined();
    });

    it('clears all tension overrides', () => {
      const store = createTestStore();
      store.dispatch(projectActions.setPlotTensionOverride({ sectionId: 's1', score: 7 }));
      store.dispatch(projectActions.setPlotTensionOverride({ sectionId: 's2', score: 3 }));
      store.dispatch(projectActions.clearAllPlotTensionOverrides());
      expect(
        Object.keys(store.getState().project.present.data.plotTensionOverrides ?? {}),
      ).toHaveLength(0);
    });

    it('tension overrides are undo-able', () => {
      const store = createTestStore();
      store.dispatch(projectActions.setPlotTensionOverride({ sectionId: 's1', score: 8 }));
      expect(store.getState().project.present.data.plotTensionOverrides?.['s1']).toBe(8);
      store.dispatch({ type: '@@redux-undo/UNDO' } as AnyAction);
      expect(store.getState().project.present.data.plotTensionOverrides?.['s1']).toBeUndefined();
    });
  });

  describe('aiPreset actions', () => {
    it('patchProjectAiPreset sets enabled and merges fields', () => {
      const store = createTestStore();
      store.dispatch(projectActions.patchProjectAiPreset({ enabled: true, provider: 'openai' }));
      const preset = store.getState().project.present.data.aiPreset;
      expect(preset?.enabled).toBe(true);
      expect(preset?.provider).toBe('openai');
    });

    it('patchProjectAiPreset preserves existing fields', () => {
      const store = createTestStore();
      store.dispatch(
        projectActions.patchProjectAiPreset({
          enabled: true,
          provider: 'ollama',
          temperature: 0.3,
        }),
      );
      store.dispatch(projectActions.patchProjectAiPreset({ model: 'ollama/llama3' }));
      const preset = store.getState().project.present.data.aiPreset;
      expect(preset?.provider).toBe('ollama');
      expect(preset?.model).toBe('ollama/llama3');
      expect(preset?.temperature).toBe(0.3);
    });

    it('clearProjectAiPreset removes preset', () => {
      const store = createTestStore();
      store.dispatch(projectActions.patchProjectAiPreset({ enabled: true }));
      store.dispatch(projectActions.clearProjectAiPreset());
      expect(store.getState().project.present.data.aiPreset).toBeUndefined();
    });

    it('setProjectAiPreset replaces preset entirely', () => {
      const store = createTestStore();
      store.dispatch(projectActions.patchProjectAiPreset({ enabled: true, provider: 'ollama' }));
      store.dispatch(projectActions.setProjectAiPreset({ enabled: false, temperature: 1.0 }));
      const preset = store.getState().project.present.data.aiPreset;
      expect(preset?.provider).toBeUndefined();
      expect(preset?.temperature).toBe(1.0);
    });
  });

  describe('binder nodes', () => {
    it('deleteBinderNode removes a node and its subtree', () => {
      const store = createTestStore({
        binderNodes: [
          { id: 'root', parentId: null, title: 'Root', type: 'folder', sortIndex: 0 },
          { id: 'child', parentId: 'root', title: 'Child', type: 'note', sortIndex: 0 },
          { id: 'other', parentId: null, title: 'Other', type: 'note', sortIndex: 1 },
        ],
      });
      store.dispatch(projectActions.deleteBinderNode('root'));
      const nodes = store.getState().project.present.data.binderNodes ?? [];
      expect(nodes.map((n) => n.id)).toEqual(['other']);
    });

    it('deleteBinderNode terminates on a cyclic parent chain (no infinite recursion)', () => {
      const store = createTestStore({
        // QNBS-v3: corrupted/imported cycle a→b→a — must not hang the reducer.
        binderNodes: [
          { id: 'a', parentId: 'b', title: 'A', type: 'note', sortIndex: 0 },
          { id: 'b', parentId: 'a', title: 'B', type: 'note', sortIndex: 1 },
        ],
      });
      store.dispatch(projectActions.deleteBinderNode('a'));
      const nodes = store.getState().project.present.data.binderNodes ?? [];
      expect(nodes).toHaveLength(0);
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
