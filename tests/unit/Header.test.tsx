import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../../components/Header';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      project: { past: [], future: [], present: { manuscript: [] } },
      status: { saving: 'idle' },
      settings: {},
    }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectCanUndo: () => true,
  selectCanRedo: () => false,
}));

vi.mock('redux-undo', () => ({
  ActionCreators: {
    undo: () => ({ type: '@@redux-undo/UNDO' }),
    redo: () => ({ type: '@@redux-undo/REDO' }),
  },
}));

vi.mock('../../constants', () => ({
  ICONS: {
    SIDEBAR_OPEN: null,
    UNDO: null,
    REDO: null,
    SEARCH: null,
    WRITER: null,
    LIGHTNING_BOLT: null,
  },
}));

// Silence import errors for complex sub-components
vi.mock('../../components/ui/SaveStatusIndicator', () => ({
  SaveStatusIndicator: () => null,
}));

vi.mock('../../components/ui/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const defaultProps = {
  currentView: 'dashboard' as const,
  setIsSidebarOpen: vi.fn(),
  isSidebarOpen: false,
  onOpenPalette: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe('Header', () => {
  it('renders without throwing', () => {
    expect(() => render(<Header {...defaultProps} />)).not.toThrow();
  });

  it('renders a header element', () => {
    const { container } = render(<Header {...defaultProps} />);
    expect(container.querySelector('header')).toBeTruthy();
  });

  it('shows the undo button', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByLabelText('common.undo')).toBeTruthy();
  });

  it('shows the redo button', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByLabelText('common.redo')).toBeTruthy();
  });

  it('shows the command palette button', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByLabelText('palette.placeholder')).toBeTruthy();
  });

  it('calls onOpenPalette when palette button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    render(<Header {...defaultProps} onOpenPalette={onOpenPalette} />);
    await user.click(screen.getByLabelText('palette.placeholder'));
    expect(onOpenPalette).toHaveBeenCalled();
  });

  it('calls setIsSidebarOpen when menu button is clicked', async () => {
    const user = userEvent.setup();
    const setIsSidebarOpen = vi.fn();
    render(<Header {...defaultProps} setIsSidebarOpen={setIsSidebarOpen} />);
    await user.click(screen.getByLabelText('header.openMenu'));
    expect(setIsSidebarOpen).toHaveBeenCalled();
  });

  it('dispatches undo when undo button is clicked', async () => {
    const user = userEvent.setup();
    render(<Header {...defaultProps} />);
    await user.click(screen.getByLabelText('common.undo'));
    expect(mockDispatch).toHaveBeenCalled();
  });
});
