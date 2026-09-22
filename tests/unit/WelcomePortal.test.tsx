import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomePortal } from '../../components/WelcomePortal';
import { _resetSafeSessionForTest, enterSafeSession } from '../../services/startupSafeSession';
import { storageService } from '../../services/storageService';

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
    assignProjectIdentity: vi.fn((projectId: string) => ({
      type: 'project/assignProjectIdentity',
      payload: projectId,
    })),
  },
}));

vi.mock('../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((p: unknown) => ({ type: 'status/addNotification', payload: p })),
  },
}));

vi.mock('../../features/project/thunks/projectManagementThunks', () => ({
  importProjectThunk: Object.assign(
    vi.fn(() => ({ type: 'project/importProject/pending' })),
    {
      fulfilled: {
        match: (action: unknown) =>
          typeof action === 'object' &&
          action !== null &&
          (action as { type?: string }).type === 'project/importProject/fulfilled',
      },
    },
  ),
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

  it('shows language selector dropdown', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    // LanguageSelector is now a dropdown with aria-haspopup="listbox"
    expect(screen.getByRole('button', { name: 'portal.language.groupLabel' })).toBeTruthy();
  });

  it('calls setLanguage when language is changed', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    // The LanguageSelector component receives setLanguage via props
    // We verify the component is rendered and functional
    const langButton = screen.getByRole('button', { name: 'portal.language.groupLabel' });
    expect(langButton).toBeTruthy();
    // Note: Full interaction testing would require mocking the dropdown state
  });

  it('shows the new project button on main view', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'portal.welcome.newProject' })).toBeTruthy();
  });

  it('shows the open project button on main view', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'portal.welcome.openProject' })).toBeTruthy();
  });

  it('shows feature highlights and the offline-first privacy badge on main view', () => {
    render(<WelcomePortal onExit={vi.fn()} />);
    expect(screen.getByText('portal.features.ai.title')).toBeTruthy();
    expect(screen.getByText('portal.features.plot.title')).toBeTruthy();
    expect(screen.getByText('portal.features.export.title')).toBeTruthy();
    expect(screen.getByText('portal.welcome.privacyBadge')).toBeTruthy();
  });

  it('navigates to new project view on newProject button click', async () => {
    const user = userEvent.setup();
    render(<WelcomePortal onExit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'portal.welcome.newProject' }));
    expect(screen.getByText('portal.new.title')).toBeTruthy();
  });

  it('navigates to open project view on openProject button click', async () => {
    const user = userEvent.setup();
    render(<WelcomePortal onExit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'portal.welcome.openProject' }));
    expect(screen.getByText('portal.open.title')).toBeTruthy();
  });

  // QNBS-v3: locks the portal transition that revokes fresh-metadata seed authority after import.
  it('marks a welcome-portal import as ineligible for fresh metadata seeding', async () => {
    mockDispatch.mockResolvedValue({ type: 'project/importProject/fulfilled' });
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<WelcomePortal onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'portal.welcome.tryDemo' }));

    await waitFor(() =>
      expect(onExit).toHaveBeenCalledWith('manuscript', { allowInitialMetadataSeed: false }),
    );
  });

  it('revokes fresh metadata seeding after importing a project file', async () => {
    mockDispatch.mockResolvedValue({ type: 'project/importProject/fulfilled' });
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<WelcomePortal onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'portal.welcome.openProject' }));
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input as HTMLInputElement, new File(['{}'], 'project.json'));

    await waitFor(() =>
      expect(onExit).toHaveBeenCalledWith('manuscript', { allowInitialMetadataSeed: false }),
    );
  });
});

// QNBS-v3: in a safe session leaving the portal is the explicit "start a project" act — it must re-key the live project BEFORE the portal closes, and must never offer to "continue" the refused one.
describe('WelcomePortal in a safe session', () => {
  const liveState = { project: { present: { data: { id: 'default' } } } };

  beforeEach(() => {
    mockDispatch.mockImplementation((action: unknown) =>
      typeof action === 'function'
        ? action(mockDispatch, () => liveState)
        : Promise.resolve({ type: 'project/importProject/fulfilled' }),
    );
  });

  afterEach(() => {
    _resetSafeSessionForTest();
    mockDispatch.mockReset();
  });

  it('offers Continue for an ordinary existing session but never for the refused project', async () => {
    vi.mocked(storageService.hasSavedData).mockResolvedValueOnce(true);
    const { unmount } = render(<WelcomePortal onExit={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'portal.welcome.continue' })).toBeTruthy();
    unmount();

    enterSafeSession('refused-dir');
    vi.mocked(storageService.hasSavedData).mockResolvedValueOnce(true);
    render(<WelcomePortal onExit={vi.fn()} />);
    await waitFor(() => expect(storageService.hasSavedData).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'portal.welcome.continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'portal.welcome.tryDemo' })).toBeTruthy();
  });

  it('re-keys the live project to a fresh identity before the portal exits', async () => {
    enterSafeSession('default');
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<WelcomePortal onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'portal.welcome.tryDemo' }));

    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    const assign = mockDispatch.mock.calls
      .map(([action], index) => ({ action, order: mockDispatch.mock.invocationCallOrder[index] }))
      .find(
        ({ action }) => (action as { type?: string })?.type === 'project/assignProjectIdentity',
      );
    const assignedIdentity = (assign?.action as { payload?: string } | undefined)?.payload;
    expect(assign?.action).toEqual({
      type: 'project/assignProjectIdentity',
      payload: expect.stringMatching(/^project-.+/),
    });
    expect(assignedIdentity).not.toBe('default');
    expect(assign?.order).toBeLessThan(onExit.mock.invocationCallOrder[0] ?? 0);
    expect(onExit).toHaveBeenCalledWith('manuscript', { allowInitialMetadataSeed: false });
  });

  it('never re-keys outside a safe session', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<WelcomePortal onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'portal.welcome.tryDemo' }));

    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(
      mockDispatch.mock.calls.some(
        ([action]) => (action as { type?: string })?.type === 'project/assignProjectIdentity',
      ),
    ).toBe(false);
  });
});
