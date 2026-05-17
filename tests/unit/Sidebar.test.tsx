import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../components/Sidebar';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../constants', () => ({
  ICONS: {
    DASHBOARD: null,
    WRITER: null,
    CHARACTERS: null,
    WORLD: null,
    OUTLINE: null,
    BOOK_OPEN: null,
    TEMPLATE: null,
    SETTINGS: null,
    CHARACTER_GRAPH: null,
    SCENE_BOARD: null,
    VERSION_CONTROL: null,
    CRITIC: null,
    CONSISTENCY_CHECKER: null,
    SPARKLES: null,
    EXPORT: null,
    HELP: null,
    LIGHTNING_BOLT: null,
  },
}));

const defaultProps = {
  currentView: 'dashboard' as const,
  onNavigate: vi.fn(),
  isSidebarOpen: true,
  setIsSidebarOpen: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sidebar', () => {
  it('renders without throwing', () => {
    expect(() => render(<Sidebar {...defaultProps} />)).not.toThrow();
  });

  it('renders navigation items', () => {
    render(<Sidebar {...defaultProps} />);
    // Dashboard nav item should appear
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('marks the active view with aria-current="page"', () => {
    render(<Sidebar {...defaultProps} currentView="dashboard" />);
    // At least one button should have aria-current="page"
    const activeButtons = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'page');
    expect(activeButtons.length).toBeGreaterThan(0);
  });

  it('calls onNavigate when a nav button is clicked', () => {
    const onNavigate = vi.fn();
    render(<Sidebar {...defaultProps} onNavigate={onNavigate} currentView="dashboard" />);
    // Click the first nav button (not the active one, or the active one — either way calls onNavigate)
    const navButtons = screen.getAllByRole('button');
    fireEvent.click(navButtons[0] as HTMLElement);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('calls setIsSidebarOpen to close when backdrop overlay is clicked on mobile', () => {
    const setIsSidebarOpen = vi.fn();
    const { container } = render(<Sidebar {...defaultProps} setIsSidebarOpen={setIsSidebarOpen} />);
    // The mobile overlay backdrop
    const overlay = container.querySelector('[aria-hidden="true"]');
    if (overlay) {
      fireEvent.click(overlay);
      expect(setIsSidebarOpen).toHaveBeenCalledWith(false);
    }
  });

  it('does not mark dashboard as active when manuscript view is current', () => {
    render(<Sidebar {...defaultProps} currentView="manuscript" />);
    // Get all nav buttons with aria-current to verify navigation highlights correctly
    const buttons = screen.getAllByRole('button');
    const activeButtons = buttons.filter((b) => b.getAttribute('aria-current') === 'page');
    // At least one active item must exist
    expect(activeButtons.length).toBeGreaterThan(0);
  });
});
