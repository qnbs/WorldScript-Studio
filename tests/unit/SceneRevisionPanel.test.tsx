/**
 * Tests for components/manuscript/SceneRevisionPanel.tsx
 * QNBS-v3: Mocks sceneRevisionService + Redux store; tests list, save, delete, diff.
 */

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListRevisions = vi.fn().mockResolvedValue([]);
const mockSaveRevision = vi.fn().mockResolvedValue(undefined);
const mockDeleteRevision = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/sceneRevisionService', () => ({
  listRevisions: (...args: unknown[]) => mockListRevisions(...args),
  saveRevision: (...args: unknown[]) => mockSaveRevision(...args),
  deleteRevision: (...args: unknown[]) => mockDeleteRevision(...args),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, string>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    language: 'en',
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { SceneRevisionPanel } from '../../components/manuscript/SceneRevisionPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECTION = {
  id: 'sec-1',
  title: 'Chapter 1',
  content: 'Current content',
  act: 1,
  wordCount: 2,
  type: 'scene' as const,
  order: 0,
};

const REVISION = {
  id: 'rev-1',
  sectionId: 'sec-1',
  createdAt: Date.now(),
  wordCount: 5,
  title: 'Chapter 1',
  content: 'Old content',
  label: 'Before edit',
};

function makeStore() {
  return configureStore({
    reducer: {
      project: (state = { present: { data: { manuscript: [SECTION] } } }) => state,
    },
  });
}

function renderPanel(section = SECTION) {
  return render(
    <Provider store={makeStore()}>
      <SceneRevisionPanel section={section} />
    </Provider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneRevisionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRevisions.mockResolvedValue([]);
    mockSaveRevision.mockResolvedValue(undefined);
    mockDeleteRevision.mockResolvedValue(undefined);
  });

  it('renders the revisions title', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('revisions.title')).toBeInTheDocument());
  });

  it('shows empty state when no revisions', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('revisions.empty')).toBeInTheDocument());
  });

  it('renders the label input', async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'revisions.labelAriaLabel' })).toBeInTheDocument(),
    );
  });

  it('renders the save named button', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('revisions.saveNamed')).toBeInTheDocument());
  });

  it('calls saveRevision when save button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(screen.getByText('revisions.saveNamed')).toBeInTheDocument());
    await user.type(screen.getByRole('textbox', { name: 'revisions.labelAriaLabel' }), 'Draft v1');
    await user.click(screen.getByText('revisions.saveNamed'));
    expect(mockSaveRevision).toHaveBeenCalledWith(
      'sec-1',
      { title: 'Chapter 1', content: 'Current content' },
      'Draft v1',
    );
  });

  it('shows revisions when listRevisions returns data', async () => {
    mockListRevisions.mockResolvedValue([REVISION]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('Before edit')).toBeInTheDocument());
  });

  it('shows showDiff / hideDiff toggle button for a revision', async () => {
    mockListRevisions.mockResolvedValue([REVISION]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('revisions.showDiff')).toBeInTheDocument());
  });

  it('shows diff when showDiff is clicked', async () => {
    const user = userEvent.setup();
    mockListRevisions.mockResolvedValue([REVISION]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('revisions.showDiff')).toBeInTheDocument());
    await user.click(screen.getByText('revisions.showDiff'));
    // After clicking, toggle changes to hideDiff
    expect(screen.getByText('revisions.hideDiff')).toBeInTheDocument();
  });

  it('shows restore confirmation flow', async () => {
    const user = userEvent.setup();
    mockListRevisions.mockResolvedValue([REVISION]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('revisions.restore')).toBeInTheDocument());
    await user.click(screen.getByText('revisions.restore'));
    expect(screen.getByText('revisions.confirmRestore')).toBeInTheDocument();
    expect(screen.getByText('revisions.cancel')).toBeInTheDocument();
  });

  it('calls deleteRevision when delete button is clicked', async () => {
    const user = userEvent.setup();
    mockListRevisions.mockResolvedValue([REVISION]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'revisions.delete' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'revisions.delete' }));
    await waitFor(() => expect(mockDeleteRevision).toHaveBeenCalledWith('rev-1'));
  });
});
