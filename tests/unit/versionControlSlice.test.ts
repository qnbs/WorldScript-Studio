import { describe, expect, it, vi } from 'vitest';
import reducer, {
  compressManuscript,
  decompressManuscript,
  MAIN_BRANCH_ID,
  selectAllBranches,
  selectCurrentBranch,
  selectCurrentBranchSnapshots,
  selectIsPanelOpen,
  versionControlActions,
} from '../../features/versionControl/versionControlSlice';
import type { StorySection } from '../../types';

vi.mock('uuid', () => ({
  v4: vi
    .fn()
    .mockReturnValueOnce('snapshot-id')
    .mockReturnValueOnce('branch-id')
    .mockReturnValue('fallback-id'),
}));

const sections: StorySection[] = [
  { id: 's1', title: 'One', content: 'Alpha beta gamma' },
  { id: 's2', title: 'Two', content: 'Delta epsilon' },
];

describe('versionControlSlice', () => {
  it('compresses and decompresses manuscript content', () => {
    const compressed = compressManuscript(sections);
    const decompressed = decompressManuscript(compressed);

    expect(decompressed).toEqual(sections);
  });

  it('returns an empty array for invalid compressed content', () => {
    expect(decompressManuscript('invalid-data')).toEqual([]);
  });

  it('creates snapshots and updates current branch head', () => {
    const state = reducer(
      undefined,
      versionControlActions.createSnapshot({ label: 'Snapshot 1', sections }),
    );

    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]?.id).toBe('snapshot-id');
    expect(state.snapshots[0]?.branchId).toBe(MAIN_BRANCH_ID);
    expect(state.snapshots[0]?.wordCount).toBe(5);
    expect(state.branches[0]?.headSnapshotId).toBe('snapshot-id');
  });

  it('creates a branch and can switch back to main branch', () => {
    const withBranch = reducer(
      undefined,
      versionControlActions.createBranch({
        name: 'Alternative Arc',
        description: 'Alternative timeline',
        fromSnapshotId: 'snapshot-id',
      }),
    );

    expect(withBranch.branches).toHaveLength(2);
    expect(withBranch.currentBranchId).toBe('branch-id');
    expect(withBranch.branches[1]?.headSnapshotId).toBe('snapshot-id');

    const switched = reducer(withBranch, versionControlActions.switchBranch(MAIN_BRANCH_ID));

    expect(switched.currentBranchId).toBe(MAIN_BRANCH_ID);
  });

  it('does not switch to unknown branch id', () => {
    const state = reducer(undefined, versionControlActions.switchBranch('missing-branch'));

    expect(state.currentBranchId).toBe(MAIN_BRANCH_ID);
  });

  it('deletes non-main branches and their snapshots', () => {
    const branched = reducer(
      undefined,
      versionControlActions.createBranch({ name: 'Temp branch', switchTo: true }),
    );

    const withSnapshot = reducer(
      branched,
      versionControlActions.createSnapshot({
        label: 'Temp snapshot',
        sections,
      }),
    );

    const branchId = withSnapshot.currentBranchId;
    const snapshotId = withSnapshot.snapshots[0]?.id;

    expect(branchId).not.toBe(MAIN_BRANCH_ID);
    expect(snapshotId).toBeDefined();

    const deleted = reducer(withSnapshot, versionControlActions.deleteBranch(branchId));

    expect(deleted.currentBranchId).toBe(MAIN_BRANCH_ID);
    expect(deleted.branches.some((branch) => branch.id === branchId)).toBe(false);
    expect(deleted.snapshots.some((snapshot) => snapshot.branchId === branchId)).toBe(false);
  });

  it('cannot delete main branch', () => {
    const state = reducer(undefined, versionControlActions.deleteBranch(MAIN_BRANCH_ID));

    expect(state.branches).toHaveLength(1);
    expect(state.branches[0]?.id).toBe(MAIN_BRANCH_ID);
  });

  it('deletes a single snapshot by id', () => {
    const withSnapshot = reducer(
      undefined,
      versionControlActions.createSnapshot({ label: 'Main snapshot', sections }),
    );

    const snapshotId = withSnapshot.snapshots[0]?.id;
    expect(snapshotId).toBeDefined();

    const state = reducer(withSnapshot, versionControlActions.deleteSnapshot(snapshotId ?? ''));

    expect(state.snapshots).toHaveLength(0);
  });

  it('toggles and controls the panel state', () => {
    const toggled = reducer(undefined, versionControlActions.togglePanel());
    expect(toggled.isPanelOpen).toBe(true);

    const closed = reducer(toggled, versionControlActions.closePanel());
    expect(closed.isPanelOpen).toBe(false);

    const opened = reducer(closed, versionControlActions.openPanel());
    expect(opened.isPanelOpen).toBe(true);
  });

  it('selectors return branch and panel information', () => {
    const state = {
      versionControl: {
        branches: [
          {
            id: MAIN_BRANCH_ID,
            name: 'main',
            description: 'Main',
            color: '#6366f1',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        currentBranchId: MAIN_BRANCH_ID,
        snapshots: [
          {
            id: 'old',
            branchId: MAIN_BRANCH_ID,
            label: 'Old',
            timestamp: '2024-01-01T00:00:00.000Z',
            manuscriptSnapshot: '',
            wordCount: 10,
          },
          {
            id: 'new',
            branchId: MAIN_BRANCH_ID,
            label: 'New',
            timestamp: '2024-01-02T00:00:00.000Z',
            manuscriptSnapshot: '',
            wordCount: 12,
          },
        ],
        isPanelOpen: true,
      },
    };

    const currentBranch = selectCurrentBranch(state);
    const snapshots = selectCurrentBranchSnapshots(state);
    const branches = selectAllBranches(state);
    const panelOpen = selectIsPanelOpen(state);

    expect(currentBranch?.id).toBe(MAIN_BRANCH_ID);
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['new', 'old']);
    expect(branches).toHaveLength(1);
    expect(panelOpen).toBe(true);
  });
});
