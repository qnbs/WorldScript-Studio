import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomePortal } from '../../components/WelcomePortal';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockSetLanguage = vi.fn();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    language: 'en',
    setLanguage: mockSetLanguage,
  }),
}));

vi.mock('../../constants', () => ({
  ICONS: {
    SPARKLES: null,
    FOLDER_OPEN: null,
    DOCUMENT_TEXT: null,
    BOOK_OPEN: null,
    TEMPLATE: null,
    LIGHTNING_BOLT: null,
    WRITER: null,
    OUTLINE: null,
    PENCIL: null,
    AI_WRITING: null,
  },
}));

vi.mock('../../features/project/projectSlice', () => ({
  projectActions: {
    createNewProject: vi.fn(() => ({ type: 'project/createNewProject' })),
  },
}));

vi.mock('../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((p: unknown) => ({ type: 'status/addNotification', payload: p })),
  },
}));

vi.mock('../../features/project/thunks/projectManagementThunks', () => ({
  importProjectThunk: vi.fn(() => async () => undefined),
}));

vi.mock('../../services/storageService', () => ({
  storageService: {
    getAllProjects: vi.fn(() => Promise.resolve([])),
    hasSavedData: vi.fn(() => Promise.resolve(false)),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WelcomePortal', () => {
  it('renders without throwing', () => {
    expect(() => render(<WelcomePortal onExit={vi.fn()} />)).not.toThrow();
  });

  it('shows language selector buttons', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    // Language buttons for all 5 locales
    expect(screen.getByRole('button', { name: 'EN' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DE' })).toBeTruthy();
  });

  it('calls setLanguage when a language button is clicked', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'DE' }));
    expect(mockSetLanguage).toHaveBeenCalledWith('de');
  });

  it('shows the new project button on main view', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'portal.welcome.newProject' })).toBeTruthy();
  });

  it('shows the open project button on main view', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'portal.welcome.openProject' })).toBeTruthy();
  });

  it('navigates to new project view on newProject button click', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'portal.welcome.newProject' }));
    expect(screen.getByText('portal.new.title')).toBeTruthy();
  });

  it('navigates to open project view on openProject button click', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'portal.welcome.openProject' }));
    expect(screen.getByText('portal.open.title')).toBeTruthy();
  });
});
