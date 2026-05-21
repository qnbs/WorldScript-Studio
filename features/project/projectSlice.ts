import type { EntityState, PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type {
  BinderNode,
  Character,
  CharacterInterview,
  CharacterRelationship,
  CompileProfile,
  InterviewMessage,
  MindMap,
  MindMapEdge,
  MindMapNode,
  ObjectGroup,
  OutlineSection,
  PersistedVersionControlState,
  PlotConnection,
  PlotConnectionType,
  ProjectAiPreset,
  StoryObject,
  StorySection,
  Subplot,
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
  // QNBS-v3: Moved from plotBoardSlice so connections/subplots/tension are undo-able via redux-undo.
  plotConnections?: PlotConnection[];
  plotSubplots?: Subplot[];
  plotTensionOverrides?: Record<string, number>;
  // QNBS-v3: Per-project AI preset — overrides global settings when enabled; supports LoRA path for v2.0.
  aiPreset?: ProjectAiPreset;
  // QNBS-v3: Story Objects/Groups inventory — foundational for MindMap linked entities in v1.7.
  storyObjects?: StoryObject[];
  objectGroups?: ObjectGroup[];
  // QNBS-v3: Mind Maps stored with project for undo support; viewport state lives in mindMapUiSlice.
  mindMaps?: MindMap[];
  // QNBS-v3: Character Interview transcripts keyed by characterId for co-location with character data.
  characterInterviews?: Record<string, CharacterInterview[]>;
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
    resetProject: (
      state,
      action: PayloadAction<{ title: string; logline: string; chapter1Title?: string }>,
    ) => {
      state.data = {
        ...initialState.data,
        title: action.payload.title,
        logline: action.payload.logline,
        characters: charactersAdapter.getInitialState(),
        worlds: worldsAdapter.getInitialState(),
        manuscript: [
          {
            id: `sec-${Date.now()}`,
            title: action.payload.chapter1Title ?? 'Chapter 1',
            content: '',
          },
        ],
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
    // --- Plot Connections (undo-able story content) ---
    addPlotConnection: (state, action: PayloadAction<PlotConnection>) => {
      if (!state.data.plotConnections) state.data.plotConnections = [];
      const exists = state.data.plotConnections.some(
        (c) =>
          c.fromSectionId === action.payload.fromSectionId &&
          c.toSectionId === action.payload.toSectionId,
      );
      if (!exists) state.data.plotConnections.push(action.payload);
    },
    updatePlotConnection: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Omit<PlotConnection, 'id'>> }>,
    ) => {
      const conn = state.data.plotConnections?.find((c) => c.id === action.payload.id);
      if (conn) Object.assign(conn, action.payload.changes);
    },
    removePlotConnection: (state, action: PayloadAction<string>) => {
      if (!state.data.plotConnections) return;
      state.data.plotConnections = state.data.plotConnections.filter(
        (c) => c.id !== action.payload,
      );
    },
    removePlotConnectionsForSection: (state, action: PayloadAction<string>) => {
      if (!state.data.plotConnections) return;
      state.data.plotConnections = state.data.plotConnections.filter(
        (c) => c.fromSectionId !== action.payload && c.toSectionId !== action.payload,
      );
    },
    // --- Plot Subplots (undo-able story content) ---
    addPlotSubplot: (state, action: PayloadAction<Subplot>) => {
      if (!state.data.plotSubplots) state.data.plotSubplots = [];
      state.data.plotSubplots.push(action.payload);
    },
    updatePlotSubplot: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Subplot> }>,
    ) => {
      const subplot = state.data.plotSubplots?.find((s) => s.id === action.payload.id);
      if (subplot) Object.assign(subplot, action.payload.changes);
    },
    deletePlotSubplot: (state, action: PayloadAction<string>) => {
      if (!state.data.plotSubplots) return;
      state.data.plotSubplots = state.data.plotSubplots.filter((s) => s.id !== action.payload);
      // Remove subplot reference from connections
      if (state.data.plotConnections) {
        for (const conn of state.data.plotConnections) {
          if (conn.subplotId === action.payload) delete conn.subplotId;
        }
      }
    },
    assignSectionToPlotSubplot: (
      state,
      action: PayloadAction<{ sectionId: string; subplotId: string }>,
    ) => {
      const subplot = state.data.plotSubplots?.find((s) => s.id === action.payload.subplotId);
      if (subplot && !subplot.sectionIds.includes(action.payload.sectionId)) {
        subplot.sectionIds.push(action.payload.sectionId);
      }
    },
    removeSectionFromPlotSubplot: (
      state,
      action: PayloadAction<{ sectionId: string; subplotId: string }>,
    ) => {
      const subplot = state.data.plotSubplots?.find((s) => s.id === action.payload.subplotId);
      if (subplot) {
        subplot.sectionIds = subplot.sectionIds.filter((id) => id !== action.payload.sectionId);
      }
    },
    // --- Plot Tension Overrides (undo-able story content) ---
    setPlotTensionOverride: (
      state,
      action: PayloadAction<{ sectionId: string; score: number }>,
    ) => {
      if (!state.data.plotTensionOverrides) state.data.plotTensionOverrides = {};
      state.data.plotTensionOverrides[action.payload.sectionId] = Math.min(
        10,
        Math.max(0, action.payload.score),
      );
    },
    clearPlotTensionOverride: (state, action: PayloadAction<string>) => {
      if (state.data.plotTensionOverrides) delete state.data.plotTensionOverrides[action.payload];
    },
    clearAllPlotTensionOverrides: (state) => {
      state.data.plotTensionOverrides = {};
    },
    // QNBS-v3: Finish draw creates connection in projectSlice so it's undo-able.
    finishPlotDrawConnection: (
      state,
      action: PayloadAction<{
        fromSectionId: string;
        toSectionId: string;
        type: PlotConnectionType;
        newId: string;
      }>,
    ) => {
      const { fromSectionId, toSectionId, type, newId } = action.payload;
      if (fromSectionId === toSectionId) return; // no self-loops
      if (!state.data.plotConnections) state.data.plotConnections = [];
      const exists = state.data.plotConnections.some(
        (c) => c.fromSectionId === fromSectionId && c.toSectionId === toSectionId,
      );
      if (!exists) {
        state.data.plotConnections.push({ id: newId, fromSectionId, toSectionId, type });
      }
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
    // QNBS-v3: Per-project AI preset — patch individual fields to avoid full-object overwrites.
    setProjectAiPreset: (state, action: PayloadAction<ProjectAiPreset>) => {
      state.data.aiPreset = action.payload;
    },
    patchProjectAiPreset: (state, action: PayloadAction<Partial<ProjectAiPreset>>) => {
      state.data.aiPreset = { enabled: false, ...state.data.aiPreset, ...action.payload };
    },
    clearProjectAiPreset: (state) => {
      delete state.data.aiPreset;
    },
    // --- Story Objects ---
    addStoryObject: (state, action: PayloadAction<StoryObject>) => {
      if (!state.data.storyObjects) state.data.storyObjects = [];
      state.data.storyObjects.push(action.payload);
    },
    updateStoryObject: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<StoryObject> }>,
    ) => {
      const obj = (state.data.storyObjects ?? []).find((o) => o.id === action.payload.id);
      if (obj) Object.assign(obj, action.payload.changes);
    },
    deleteStoryObject: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      state.data.storyObjects = (state.data.storyObjects ?? []).filter((o) => o.id !== id);
      // QNBS-v3: cascade remove from all groups so referential integrity is preserved.
      for (const g of state.data.objectGroups ?? []) {
        g.objectIds = g.objectIds.filter((oid) => oid !== id);
      }
    },
    addObjectGroup: (state, action: PayloadAction<ObjectGroup>) => {
      if (!state.data.objectGroups) state.data.objectGroups = [];
      state.data.objectGroups.push(action.payload);
    },
    updateObjectGroup: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<ObjectGroup> }>,
    ) => {
      const g = (state.data.objectGroups ?? []).find((g) => g.id === action.payload.id);
      if (g) Object.assign(g, action.payload.changes);
    },
    deleteObjectGroup: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      state.data.objectGroups = (state.data.objectGroups ?? []).filter((g) => g.id !== id);
      // QNBS-v3: cascade clear groupId from affected objects.
      for (const o of state.data.storyObjects ?? []) {
        o.groupIds = o.groupIds.filter((gid) => gid !== id);
      }
    },
    assignObjectToGroup: (state, action: PayloadAction<{ objectId: string; groupId: string }>) => {
      const { objectId, groupId } = action.payload;
      const obj = (state.data.storyObjects ?? []).find((o) => o.id === objectId);
      const grp = (state.data.objectGroups ?? []).find((g) => g.id === groupId);
      if (obj && !obj.groupIds.includes(groupId)) obj.groupIds.push(groupId);
      if (grp && !grp.objectIds.includes(objectId)) grp.objectIds.push(objectId);
    },
    removeObjectFromGroup: (
      state,
      action: PayloadAction<{ objectId: string; groupId: string }>,
    ) => {
      const { objectId, groupId } = action.payload;
      const obj = (state.data.storyObjects ?? []).find((o) => o.id === objectId);
      const grp = (state.data.objectGroups ?? []).find((g) => g.id === groupId);
      if (obj) obj.groupIds = obj.groupIds.filter((gid) => gid !== groupId);
      if (grp) grp.objectIds = grp.objectIds.filter((oid) => oid !== objectId);
    },
    // --- Mind Maps ---
    addMindMap: (state, action: PayloadAction<MindMap>) => {
      if (!state.data.mindMaps) state.data.mindMaps = [];
      state.data.mindMaps.push(action.payload);
    },
    updateMindMap: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Omit<MindMap, 'nodes' | 'edges'>> }>,
    ) => {
      const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.id);
      if (map) Object.assign(map, action.payload.changes);
    },
    deleteMindMap: (state, action: PayloadAction<string>) => {
      state.data.mindMaps = (state.data.mindMaps ?? []).filter((m) => m.id !== action.payload);
    },
    addMindMapNode: (state, action: PayloadAction<{ mapId: string; node: MindMapNode }>) => {
      const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
      if (map) map.nodes.push(action.payload.node);
    },
    updateMindMapNode: (
      state,
      action: PayloadAction<{ mapId: string; nodeId: string; changes: Partial<MindMapNode> }>,
    ) => {
      const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
      const node = map?.nodes.find((n) => n.id === action.payload.nodeId);
      if (node) Object.assign(node, action.payload.changes);
    },
    deleteMindMapNode: (state, action: PayloadAction<{ mapId: string; nodeId: string }>) => {
      const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
      if (!map) return;
      map.nodes = map.nodes.filter((n) => n.id !== action.payload.nodeId);
      // QNBS-v3: cascade delete edges connected to removed node to prevent dangling references.
      map.edges = map.edges.filter(
        (e) => e.sourceNodeId !== action.payload.nodeId && e.targetNodeId !== action.payload.nodeId,
      );
    },
    addMindMapEdge: (state, action: PayloadAction<{ mapId: string; edge: MindMapEdge }>) => {
      const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
      if (map) map.edges.push(action.payload.edge);
    },
    updateMindMapEdge: (
      state,
      action: PayloadAction<{ mapId: string; edgeId: string; changes: Partial<MindMapEdge> }>,
    ) => {
      const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
      const edge = map?.edges.find((e) => e.id === action.payload.edgeId);
      if (edge) Object.assign(edge, action.payload.changes);
    },
    deleteMindMapEdge: (state, action: PayloadAction<{ mapId: string; edgeId: string }>) => {
      const map = (state.data.mindMaps ?? []).find((m) => m.id === action.payload.mapId);
      if (map) map.edges = map.edges.filter((e) => e.id !== action.payload.edgeId);
    },

    // ── Character Interviews ───────────────────────────────────────────────
    addCharacterInterview: (
      state,
      action: PayloadAction<{ characterId: string; interview: CharacterInterview }>,
    ) => {
      if (!state.data.characterInterviews) state.data.characterInterviews = {};
      const { characterId, interview } = action.payload;
      if (!state.data.characterInterviews[characterId]) {
        state.data.characterInterviews[characterId] = [];
      }
      state.data.characterInterviews[characterId].push(interview);
    },
    appendInterviewMessage: (
      state,
      action: PayloadAction<{
        characterId: string;
        interviewId: string;
        message: InterviewMessage;
      }>,
    ) => {
      const { characterId, interviewId, message } = action.payload;
      const interviews = state.data.characterInterviews?.[characterId] ?? [];
      const interview = interviews.find((iv) => iv.id === interviewId);
      if (interview) {
        interview.messages.push(message);
        interview.updatedAt = message.timestamp;
      }
    },
    deleteCharacterInterview: (
      state,
      action: PayloadAction<{ characterId: string; interviewId: string }>,
    ) => {
      const { characterId, interviewId } = action.payload;
      if (state.data.characterInterviews?.[characterId]) {
        state.data.characterInterviews[characterId] = state.data.characterInterviews[
          characterId
        ].filter((iv) => iv.id !== interviewId);
      }
    },
    updateCharacterInterview: (
      state,
      action: PayloadAction<{
        characterId: string;
        interviewId: string;
        changes: Partial<Omit<CharacterInterview, 'messages'>>;
      }>,
    ) => {
      const { characterId, interviewId, changes } = action.payload;
      const interviews = state.data.characterInterviews?.[characterId] ?? [];
      const interview = interviews.find((iv) => iv.id === interviewId);
      if (interview) Object.assign(interview, changes);
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
      })
      // QNBS-v3: streaming interview chunks update the AI message content in-place without N separate actions
      .addMatcher(
        (
          action,
        ): action is {
          type: 'project/streamInterviewChunk';
          payload: { characterId: string; interviewId: string; aiMsgId: string; content: string };
        } => action.type === 'project/streamInterviewChunk',
        (state, action) => {
          const { characterId, interviewId, aiMsgId, content } = action.payload;
          const interviews = state.data.characterInterviews?.[characterId] ?? [];
          const interview = interviews.find((iv) => iv.id === interviewId);
          if (!interview) return;
          const msg = interview.messages.find((m) => m.id === aiMsgId);
          if (msg) msg.content = content;
        },
      );
  },
});

export const projectActions = projectSlice.actions;
export default projectSlice.reducer;
