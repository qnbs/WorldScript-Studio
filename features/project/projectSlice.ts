import type { EntityState, PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type {
  BinderNode,
  Character,
  CharacterRelationship,
  CompileProfile,
  OutlineSection,
  PersistedVersionControlState,
  StorySection,
  World,
  WritingGoal,
  WritingSession,
} from '../../types';
import { charactersAdapter, worldsAdapter } from './adapters';
import {
  generateCharacterPortraitThunk,
  uploadCharacterImageThunk,
} from './thunks/characterThunks';
import { importProjectThunk, restoreSnapshotThunk } from './thunks/projectManagementThunks';
import { generateWorldImageThunk, uploadWorldImageThunk } from './thunks/worldThunks';

// --- Re-exports for consumers ---
export { charactersAdapter, worldsAdapter } from './adapters';
export { createDeduplicatedThunk } from './aiThunkUtils';
export {
  importBinderFileThunk,
  removeBinderSubtreeWithAssetsThunk,
} from './thunks/binderThunks';
export {
  generateCharacterPortraitThunk,
  generateCharacterProfileThunk,
  regenerateCharacterFieldThunk,
  uploadCharacterImageThunk,
} from './thunks/characterThunks';
export {
  generateCustomTemplateThunk,
  generateOutlineThunk,
  personalizeTemplateThunk,
  regenerateOutlineSectionThunk,
} from './thunks/outlineThunks';
export { importProjectThunk, restoreSnapshotThunk } from './thunks/projectManagementThunks';
export {
  generateWorldImageThunk,
  generateWorldProfileThunk,
  regenerateWorldFieldThunk,
  uploadWorldImageThunk,
} from './thunks/worldThunks';
export {
  generateLoglineSuggestionsThunk,
  generateSynopsisThunk,
  proofreadTextThunk,
  streamGenerationThunk,
} from './thunks/writingThunks';

// --- Types ---
export interface ProjectData {
  id?: string;
  title: string;
  logline: string;
  author?: string;
  characters: EntityState<Character, string>;
  worlds: EntityState<World, string>;
  outline: OutlineSection[];
  manuscript: StorySection[];
  relationships?: CharacterRelationship[];
  projectGoals?: {
    totalWordCount: number;
    targetDate: string | null;
  };
  writingHistory?: {
    date: string; // YYYY-MM-DD
    words: number;
  }[];
  writingSessions?: WritingSession[];
  writingGoals?: WritingGoal[];
  sceneBoardLayout?: { [sectionId: string]: { x: number; y: number } };
  binderNodes?: BinderNode[];
  compileProfile?: CompileProfile;
  /** Saved with project so version branches/snapshots survive reload (Embedded VC). */
  persistedVersionControl?: PersistedVersionControlState;
}

// --- Initial State ---
const initialState: { data: ProjectData } = {
  data: {
    id: 'default',
    title: '',
    logline: '',
    characters: charactersAdapter.getInitialState(),
    worlds: worldsAdapter.getInitialState(),
    outline: [],
    manuscript: [],
    projectGoals: {
      totalWordCount: 50000,
      targetDate: null,
    },
    writingHistory: [],
    binderNodes: [],
  },
};

// --- Slice Definition ---
const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    // --- Project Meta ---
    updateTitle: (state, action: PayloadAction<string>) => {
      state.data.title = action.payload;
    },
    updateLogline: (state, action: PayloadAction<string>) => {
      state.data.logline = action.payload;
    },
    updateProjectGoal: (
      state,
      action: PayloadAction<{
        key: 'totalWordCount' | 'targetDate';
        value: number | string | null;
      }>,
    ) => {
      if (state.data.projectGoals) {
        if (action.payload.key === 'totalWordCount') {
          state.data.projectGoals.totalWordCount = action.payload.value as number;
        } else if (action.payload.key === 'targetDate') {
          state.data.projectGoals.targetDate = action.payload.value as string | null;
        }
      }
    },
    resetProject: (state, action: PayloadAction<{ title: string; logline: string }>) => {
      state.data = {
        ...initialState.data,
        title: action.payload.title,
        logline: action.payload.logline,
        characters: charactersAdapter.getInitialState(),
        worlds: worldsAdapter.getInitialState(),
        manuscript: [{ id: `sec-${Date.now()}`, title: 'Chapter 1', content: '' }],
        binderNodes: [],
      };
    },
    // --- Characters ---
    addCharacter: (state, action: PayloadAction<Partial<Character> & { name: string }>) => {
      const newChar: Character = {
        id: uuidv4(),
        backstory: '',
        motivation: '',
        appearance: '',
        personalityTraits: '',
        flaws: '',
        notes: '',
        hasAvatar: false,
        characterArc: '',
        relationships: '',
        ...action.payload,
      };
      charactersAdapter.addOne(state.data.characters, newChar);
    },
    updateCharacter: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Character> }>,
    ) => {
      charactersAdapter.updateOne(state.data.characters, {
        id: action.payload.id,
        changes: action.payload.changes,
      });
    },
    deleteCharacter: (state, action: PayloadAction<string>) => {
      charactersAdapter.removeOne(state.data.characters, action.payload);
    },
    // --- Worlds ---
    addWorld: (state, action: PayloadAction<Partial<World> & { name: string }>) => {
      const newWorld: World = {
        id: uuidv4(),
        description: '',
        geography: '',
        magicSystem: '',
        culture: '',
        notes: '',
        hasAmbianceImage: false,
        timeline: [],
        locations: [],
        ...action.payload,
      };
      worldsAdapter.addOne(state.data.worlds, newWorld);
    },
    updateWorld: (state, action: PayloadAction<{ id: string; changes: Partial<World> }>) => {
      worldsAdapter.updateOne(state.data.worlds, {
        id: action.payload.id,
        changes: action.payload.changes,
      });
    },
    deleteWorld: (state, action: PayloadAction<string>) => {
      worldsAdapter.removeOne(state.data.worlds, action.payload);
    },
    // --- Outline ---
    setOutline: (state, action: PayloadAction<OutlineSection[]>) => {
      state.data.outline = action.payload;
    },
    // --- Manuscript ---
    setManuscript: (state, action: PayloadAction<StorySection[]>) => {
      state.data.manuscript = action.payload;
    },
    updateManuscriptSection: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<StorySection> }>,
    ) => {
      const index = state.data.manuscript.findIndex((s) => s.id === action.payload.id);
      if (index !== -1) {
        const section = state.data.manuscript[index];
        if (section) {
          Object.assign(section, action.payload.changes);
        }
      }
    },
    addManuscriptSection: (state, action: PayloadAction<{ title: string; index?: number }>) => {
      const newSection: StorySection = {
        id: uuidv4(),
        title: action.payload.title,
        content: '',
      };
      if (action.payload.index !== undefined) {
        state.data.manuscript.splice(action.payload.index, 0, newSection);
      } else {
        state.data.manuscript.push(newSection);
      }
    },
    deleteManuscriptSection: (state, action: PayloadAction<string>) => {
      state.data.manuscript = state.data.manuscript.filter((s) => s.id !== action.payload);
    },
    // QNBS-v3: Tastatur-/Button-Reihenfolge im Scene Board pro Akt — ohne DnD-only-Zwang.
    moveManuscriptSectionWithinAct: (
      state,
      action: PayloadAction<{ id: string; direction: 'up' | 'down' }>,
    ) => {
      const { id, direction } = action.payload;
      const ms = state.data.manuscript;
      const idx = ms.findIndex((s) => s.id === id);
      if (idx === -1) return;
      const act = ms[idx]?.act ?? 1;
      const indicesInAct: number[] = [];
      for (let i = 0; i < ms.length; i++) {
        const s = ms[i];
        if (s && (s.act ?? 1) === act) indicesInAct.push(i);
      }
      const posInAct = indicesInAct.indexOf(idx);
      if (posInAct === -1) return;
      const targetPosInAct = posInAct + (direction === 'up' ? -1 : 1);
      if (targetPosInAct < 0 || targetPosInAct >= indicesInAct.length) return;
      const j = indicesInAct[targetPosInAct];
      if (j === undefined) return;
      const next = [...ms];
      const a = next[idx];
      const b = next[j];
      if (!a || !b) return;
      next[idx] = b;
      next[j] = a;
      state.data.manuscript = next;
    },
    // --- Relationships ---
    addRelationship: (state, action: PayloadAction<CharacterRelationship>) => {
      if (!state.data.relationships) state.data.relationships = [];
      state.data.relationships.push(action.payload);
    },
    updateRelationship: (
      state,
      action: PayloadAction<{
        id: string;
        changes: Partial<CharacterRelationship>;
      }>,
    ) => {
      if (!state.data.relationships) state.data.relationships = [];
      const index = state.data.relationships.findIndex((r) => r.id === action.payload.id);
      if (index !== -1) {
        const relationship = state.data.relationships[index];
        if (relationship) {
          Object.assign(relationship, action.payload.changes);
        }
      }
    },
    deleteRelationship: (state, action: PayloadAction<string>) => {
      if (!state.data.relationships) state.data.relationships = [];
      state.data.relationships = state.data.relationships.filter((r) => r.id !== action.payload);
    },
    // --- Scene Board ---
    updateSceneBoardLayout: (
      state,
      action: PayloadAction<{ [sectionId: string]: { x: number; y: number } }>,
    ) => {
      state.data.sceneBoardLayout = {
        ...state.data.sceneBoardLayout,
        ...action.payload,
      };
    },
    // --- Writing Analytics ---
    addWritingSession: (state, action: PayloadAction<WritingSession>) => {
      if (!state.data.writingSessions) state.data.writingSessions = [];
      state.data.writingSessions.push(action.payload);
    },
    updateWritingGoal: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<WritingGoal> }>,
    ) => {
      if (!state.data.writingGoals) state.data.writingGoals = [];
      const index = state.data.writingGoals.findIndex((g) => g.id === action.payload.id);
      if (index !== -1) {
        const goal = state.data.writingGoals[index];
        if (goal) {
          Object.assign(goal, action.payload.changes);
        }
      }
    },
    // QNBS-v3: Binder / Research-Knoten offline-first im Projekt — ergänzt klassische Autoren-Pipeline ohne Cloud.
    setBinderNodes: (state, action: PayloadAction<BinderNode[]>) => {
      state.data.binderNodes = action.payload;
    },
    addBinderNode: (state, action: PayloadAction<BinderNode>) => {
      if (!state.data.binderNodes) state.data.binderNodes = [];
      state.data.binderNodes.push(action.payload);
    },
    updateBinderNode: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<BinderNode> }>,
    ) => {
      const nodes = state.data.binderNodes;
      if (!nodes) return;
      const idx = nodes.findIndex((n) => n.id === action.payload.id);
      if (idx === -1) return;
      const node = nodes[idx];
      if (node) Object.assign(node, action.payload.changes);
    },
    deleteBinderNode: (state, action: PayloadAction<string>) => {
      const rootId = action.payload;
      const nodes = state.data.binderNodes;
      if (!nodes?.length) return;
      const toRemove = new Set<string>();
      const collect = (pid: string) => {
        toRemove.add(pid);
        for (const n of nodes) {
          if (n.parentId === pid) collect(n.id);
        }
      };
      collect(rootId);
      state.data.binderNodes = nodes.filter((n) => !toRemove.has(n.id));
    },
    updateCompileProfile: (state, action: PayloadAction<Partial<CompileProfile>>) => {
      state.data.compileProfile = { ...state.data.compileProfile, ...action.payload };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(importProjectThunk.fulfilled, (state, action) => {
        state.data = action.payload;
      })
      .addCase(restoreSnapshotThunk.fulfilled, (state, action) => {
        state.data = action.payload as ProjectData;
      })
      .addCase(generateCharacterPortraitThunk.fulfilled, (state, action) => {
        charactersAdapter.updateOne(state.data.characters, {
          id: action.payload.characterId,
          changes: { hasAvatar: true },
        });
      })
      .addCase(uploadCharacterImageThunk.fulfilled, (state, action) => {
        charactersAdapter.updateOne(state.data.characters, {
          id: action.payload.characterId,
          changes: { hasAvatar: true },
        });
      })
      .addCase(generateWorldImageThunk.fulfilled, (state, action) => {
        worldsAdapter.updateOne(state.data.worlds, {
          id: action.payload.worldId,
          changes: { hasAmbianceImage: true },
        });
      })
      .addCase(uploadWorldImageThunk.fulfilled, (state, action) => {
        worldsAdapter.updateOne(state.data.worlds, {
          id: action.payload.worldId,
          changes: { hasAmbianceImage: true },
        });
      });
  },
});

export const projectActions = projectSlice.actions;
export default projectSlice.reducer;
