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
