import type { EntityState } from '@reduxjs/toolkit';
import type {
  BinderNode,
  Character,
  CharacterInterview,
  CharacterRelationship,
  CompileProfile,
  MindMap,
  ObjectGroup,
  OutlineSection,
  PersistedVersionControlState,
  PlotConnection,
  ProjectAiPreset,
  StoryObject,
  StorySection,
  Subplot,
  World,
  WritingGoal,
  WritingSession,
} from '../../types';
import { charactersAdapter, worldsAdapter } from './adapters';

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

// QNBS-v3: Shared slice-state shape so reducer case modules (features/project/reducers/*) can
// type their Immer draft param without `any` — preserves WritableDraft typing across the split.
export interface ProjectSliceState {
  data: ProjectData;
}

// QNBS-v3: Canonical initial state. Lives here (not in projectSlice) so reducer modules such as
// metaReducers.resetProject can reference it without a circular import back through the slice.
export const initialState: ProjectSliceState = {
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
