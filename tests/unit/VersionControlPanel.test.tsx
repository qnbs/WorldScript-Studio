import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionControlPanel } from '../../components/VersionControlPanel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

const baseBranch = {
  id: 'main',
  name: 'main',
  description: 'Main branch',
  color: '#6366f1',
  createdAt: '2026-01-01T00:00:00.000Z',
  headSnapshotId: undefined as string | undefined,
};

const baseSnapshot = {
  id: 'snap-1',
  branchId: 'main',
  label: 'Chapter 1 draft',
  timestamp: '2026-05-01T12:00:00.000Z',
  manuscriptSnapshot: '',
  wordCount: 1500,
  parentId: undefined as string | undefined,
};

type State = {
  isPanelOpen: boolean;
  currentBranchId: string;
  snapshots: (typeof baseSnapshot)[];
  branches: (typeof baseBranch)[];
};

let vcState: State = {
  isPanelOpen: false,
  currentBranchId: 'main',
  snapshots: [],
  branches: [baseBranch],
};

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      versionControl: vcState,
      project: {
        present: {
          data: {
            title: 'Test Story',
            manuscript: [{ id: 's1', title: 'Chapter 1', content: 'Once upon a time.' }],
            outline: [],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
          },
        },
      },
    }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vcState = {
    isPanelOpen: false,
    currentBranchId: 'main',
    snapshots: [],
    branches: [{ ...baseBranch }],
  };
});

describe('VersionControlPanel — closed state', () => {
  it('renders without throwing', () => {
    expect(() => render(<VersionControlPanel />)).not.toThrow();
  });

  it('does not show panel content when isPanelOpen is false', () => {
    render(<VersionControlPanel />);
    expect(screen.queryByText('vc.title')).toBeNull();
  });
});

describe('VersionControlPanel — open state', () => {
  beforeEach(() => {
    vcState.isPanelOpen = true;
  });

  it('shows panel title when open', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('vc.title')).toBeTruthy();
  });

  it('shows current branch section', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('vc.currentBranch')).toBeTruthy();
  });

  it('shows branch name', () => {
    render(<VersionControlPanel />);
    // 'main' appears in both current branch and all branches list — use getAllByText
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
  });

  it('shows switch and new branch buttons', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('vc.switch')).toBeTruthy();
    expect(screen.getByText('vc.newBranch')).toBeTruthy();
  });

  it('shows no snapshots message when no snapshots', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('vc.noSnapshots')).toBeTruthy();
  });

  it('shows new snapshot button', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('vc.newSnapshot')).toBeTruthy();
  });

  it('shows close button', () => {
    render(<VersionControlPanel />);
    expect(screen.getByLabelText('vc.close')).toBeTruthy();
  });

  it('dispatches closePanel when close button clicked', () => {
    render(<VersionControlPanel />);
    fireEvent.click(screen.getByLabelText('vc.close'));
    expect(mockDispatch).toHaveBeenCalled();
  });
});

describe('VersionControlPanel — with snapshots', () => {
  beforeEach(() => {
    vcState = {
      isPanelOpen: true,
      currentBranchId: 'main',
      snapshots: [{ ...baseSnapshot }],
      branches: [{ ...baseBranch, headSnapshotId: 'snap-1' }],
    };
  });

  it('shows snapshot label', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('Chapter 1 draft')).toBeTruthy();
  });

  it('shows snapshot word count', () => {
    render(<VersionControlPanel />);
    // wordCount uses toLocaleString() — check for vc.words label which always appears
    expect(screen.getByText(/vc\.words/)).toBeTruthy();
  });

  it('shows restore button for snapshot', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('vc.restore')).toBeTruthy();
  });

  it('shows compare button for snapshot', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText('vc.compare')).toBeTruthy();
  });
});

describe('VersionControlPanel — create snapshot modal', () => {
  beforeEach(() => {
    vcState.isPanelOpen = true;
  });

  it('opens create snapshot modal when new snapshot button is clicked', () => {
    render(<VersionControlPanel />);
    fireEvent.click(screen.getByText('vc.newSnapshot'));
    // Modal has createSnapshotTitle in both title and confirm button — check description
    expect(screen.getByText('vc.createSnapshotDescription')).toBeTruthy();
  });

  it('shows snapshot name placeholder in modal', () => {
    render(<VersionControlPanel />);
    fireEvent.click(screen.getByText('vc.newSnapshot'));
    expect(screen.getByPlaceholderText('vc.snapshotPlaceholder')).toBeTruthy();
  });
});

describe('VersionControlPanel — all branches section', () => {
  beforeEach(() => {
    vcState = {
      isPanelOpen: true,
      currentBranchId: 'main',
      snapshots: [],
      branches: [
        { ...baseBranch },
        {
          id: 'feature-1',
          name: 'experimental',
          description: 'Experimental rewrite',
          color: '#f59e0b',
          createdAt: '2026-04-01T00:00:00.000Z',
          headSnapshotId: undefined as string | undefined,
        },
      ],
    };
  });

  it('shows all branches section', () => {
    render(<VersionControlPanel />);
    expect(screen.getByText(/vc.allBranches/)).toBeTruthy();
  });

  it('shows both branch names', () => {
    render(<VersionControlPanel />);
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    expect(screen.getByText('experimental')).toBeTruthy();
  });
});
