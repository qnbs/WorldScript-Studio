import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BinderPanel } from '../../components/BinderPanel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      project: {
        present: {
          data: {
            id: 'proj1',
            title: 'Test Project',
            binderNodes: [],
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
});
