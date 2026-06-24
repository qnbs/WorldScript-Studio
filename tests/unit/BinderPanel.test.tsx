import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BinderPanel } from '../../components/BinderPanel';
import type { BinderNode } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

// Mutable so individual tests can exercise the node-render path (binderDepth).
let mockBinderNodes: BinderNode[] = [];

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      project: {
        present: {
          data: {
            id: 'proj1',
            title: 'Test Project',
            binderNodes: mockBinderNodes,
            manuscript: [],
            outline: [],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
          },
        },
      },
    }),
  ),
}));

vi.mock('../../app/transientUiStore', () => ({
  useTransientUiStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      activeBinderNodeId: null,
      setActiveBinderNodeId: vi.fn(),
    }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../services/storageService', () => ({
  storageService: {
    getBinderAsset: vi.fn().mockResolvedValue(null),
    saveBinderAsset: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../features/project/thunks/binderThunks', () => ({
  importBinderFileThunk: vi.fn(),
  removeBinderSubtreeWithAssetsThunk: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BinderPanel', () => {
  beforeEach(() => {
    mockBinderNodes = [];
    mockDispatch.mockReset();
  });

  it('renders without throwing', () => {
    expect(() => render(<BinderPanel />)).not.toThrow();
  });

  it('shows add folder button', () => {
    render(<BinderPanel />);
    expect(screen.getByText('manuscript.binder.addFolder')).toBeTruthy();
  });

  it('shows add note button', () => {
    render(<BinderPanel />);
    expect(screen.getByText('manuscript.binder.addNote')).toBeTruthy();
  });

  it('shows empty state when no binder nodes', () => {
    render(<BinderPanel />);
    // No nodes means the panel should render just buttons and no node items
    const addButtons = screen.getAllByRole('button');
    expect(addButtons.length).toBeGreaterThan(0);
  });

  it('indents nested nodes by their depth (binderDepth)', () => {
    // QNBS-v3: covers the binderDepth ancestor-walk + the node-render path —
    // a root folder, a child, and a grandchild produce increasing paddingLeft.
    mockBinderNodes = [
      { id: 'root', parentId: null, type: 'folder', title: 'Root Folder', sortIndex: 0 },
      { id: 'child', parentId: 'root', type: 'folder', title: 'Child Folder', sortIndex: 0 },
      { id: 'grand', parentId: 'child', type: 'note', title: 'Grandchild Note', sortIndex: 0 },
    ];
    render(<BinderPanel />);

    const root = screen.getByText('Root Folder').closest('button');
    const child = screen.getByText('Child Folder').closest('button');
    const grand = screen.getByText('Grandchild Note').closest('button');

    // paddingLeft = 8 + depth * 12 → 8px (depth 0), 20px (depth 1), 32px (depth 2).
    expect(root?.style.paddingLeft).toBe('8px');
    expect(child?.style.paddingLeft).toBe('20px');
    expect(grand?.style.paddingLeft).toBe('32px');
  });
});
