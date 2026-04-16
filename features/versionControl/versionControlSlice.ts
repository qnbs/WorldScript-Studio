import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import * as LZString from 'lz-string';
import { v4 as uuid } from 'uuid';
import type { VersionBranch, VersionSnapshot } from '../../types';
import type { StorySection } from '../../types';

// ─── State ────────────────────────────────────────────────────────────────────

const BRANCH_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#f97316',
  '#84cc16',
  '#06b6d4',
];
const DEFAULT_BRANCH_COLOR = BRANCH_COLORS[0] as string;

export const MAIN_BRANCH_ID = 'main';

const initialMainBranch: VersionBranch = {
  id: MAIN_BRANCH_ID,
  name: 'main',
  description: 'Hauptlinie der Geschichte',
  color: '#6366f1',
  createdAt: new Date().toISOString(),
};

interface VersionControlState {
  branches: VersionBranch[];
  currentBranchId: string;
  snapshots: VersionSnapshot[];
  isPanelOpen: boolean;
}

const initialState: VersionControlState = {
  branches: [initialMainBranch],
  currentBranchId: MAIN_BRANCH_ID,
  snapshots: [],
  isPanelOpen: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function compressManuscript(sections: StorySection[]): string {
  return LZString.compressToUTF16(JSON.stringify(sections));
}

export function decompressManuscript(compressed: string): StorySection[] {
  try {
    const json = LZString.decompressFromUTF16(compressed);
    return json ? (JSON.parse(json) as StorySection[]) : [];
  } catch {
    return [];
  }
}

function countWords(sections: StorySection[]): number {
  return sections.reduce((acc, s) => {
    const text = s.content ?? '';
    return acc + (text.trim() ? text.trim().split(/\s+/).length : 0);
  }, 0);
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const versionControlSlice = createSlice({
  name: 'versionControl',
  initialState,
  reducers: {
    /** Create a snapshot of the current manuscript on the current branch */
    createSnapshot(
      state,
      action: PayloadAction<{
        label: string;
        sections: StorySection[];
        parentId?: string;
      }>
    ) {
      const { label, sections, parentId } = action.payload;
      const id = uuid();
      const snapshot: VersionSnapshot = {
        id,
        branchId: state.currentBranchId,
        label,
        timestamp: new Date().toISOString(),
        manuscriptSnapshot: compressManuscript(sections),
        wordCount: countWords(sections),
        ...(parentId ? { parentId } : {}),
      };
      state.snapshots.push(snapshot);

      // Update branch head
      const branch = state.branches.find((b) => b.id === state.currentBranchId);
      if (branch) branch.headSnapshotId = id;
    },

    /** Create a new branch (optionally from an existing snapshot) */
    createBranch(
      state,
      action: PayloadAction<{
        name: string;
        description?: string;
        fromSnapshotId?: string;
        switchTo?: boolean;
      }>
    ) {
      const { name, description = '', fromSnapshotId, switchTo = true } = action.payload;
      const colorIndex = state.branches.length % BRANCH_COLORS.length;
      const id = uuid();
      const branch: VersionBranch = {
        id,
        name,
        description,
        color: BRANCH_COLORS[colorIndex] ?? DEFAULT_BRANCH_COLOR,
        createdAt: new Date().toISOString(),
        ...(fromSnapshotId ? { headSnapshotId: fromSnapshotId } : {}),
      };
      state.branches.push(branch);
      if (switchTo) state.currentBranchId = id;
    },

    /** Switch to an existing branch */
    switchBranch(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.branches.find((b) => b.id === id)) {
        state.currentBranchId = id;
      }
    },

    /** Delete a branch (and its snapshots). Main branch cannot be deleted. */
    deleteBranch(state, action: PayloadAction<string>) {
      if (action.payload === MAIN_BRANCH_ID) return;
      state.branches = state.branches.filter((b) => b.id !== action.payload);
      state.snapshots = state.snapshots.filter((s) => s.branchId !== action.payload);
      if (state.currentBranchId === action.payload) {
        state.currentBranchId = MAIN_BRANCH_ID;
      }
    },

    /** Delete a single snapshot */
    deleteSnapshot(state, action: PayloadAction<string>) {
      state.snapshots = state.snapshots.filter((s) => s.id !== action.payload);
    },

    /** Open/close the version control panel */
    togglePanel(state) {
      state.isPanelOpen = !state.isPanelOpen;
    },
    openPanel(state) {
      state.isPanelOpen = true;
    },
    closePanel(state) {
      state.isPanelOpen = false;
    },
  },
});

export const versionControlActions = versionControlSlice.actions;
export default versionControlSlice.reducer;

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectCurrentBranch = (state: { versionControl: VersionControlState }) =>
  state.versionControl.branches.find((b) => b.id === state.versionControl.currentBranchId);

export const selectCurrentBranchSnapshots = (state: { versionControl: VersionControlState }) =>
  state.versionControl.snapshots
    .filter((s) => s.branchId === state.versionControl.currentBranchId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

export const selectAllBranches = (state: { versionControl: VersionControlState }) =>
  state.versionControl.branches;

export const selectIsPanelOpen = (state: { versionControl: VersionControlState }) =>
  state.versionControl.isPanelOpen;
