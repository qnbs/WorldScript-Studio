/**
 * Tests for components/manuscript/CommentsPanel.tsx
 * QNBS-v3: Provides Redux store with sceneComments slice; tests add/resolve/delete/reply.
 */

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sceneCommentsReducer from '../../features/sceneComments/sceneCommentsSlice';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, string>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    language: 'en',
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { CommentsPanel } from '../../components/manuscript/CommentsPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(preloadedState = {}) {
  return configureStore({
    reducer: { sceneComments: sceneCommentsReducer },
    preloadedState,
  });
}

function renderPanel(sectionId = 'sec-1', store = makeStore()) {
  return render(
    <Provider store={store}>
      <CommentsPanel sectionId={sectionId} />
    </Provider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the comments title', () => {
    renderPanel();
    expect(screen.getByText('comments.title')).toBeInTheDocument();
  });

  it('shows empty state when no comments', () => {
    renderPanel();
    expect(screen.getByText('comments.empty')).toBeInTheDocument();
  });

  it('renders the new comment textarea', () => {
    renderPanel();
    expect(screen.getByRole('textbox', { name: 'comments.newAriaLabel' })).toBeInTheDocument();
  });

  it('add button is disabled when input is empty', () => {
    renderPanel();
    expect(screen.getByText('comments.add').closest('button')).toBeDisabled();
  });

  it('adds a comment when add button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'comments.newAriaLabel' }), 'Test comment');
    await user.click(screen.getByText('comments.add'));
    expect(screen.getByText('Test comment')).toBeInTheDocument();
    expect(screen.queryByText('comments.empty')).not.toBeInTheDocument();
  });

  it('clears the textarea after adding a comment', async () => {
    const user = userEvent.setup();
    renderPanel();
    const textarea = screen.getByRole('textbox', { name: 'comments.newAriaLabel' });
    await user.type(textarea, 'My comment');
    await user.click(screen.getByText('comments.add'));
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('resolves a comment when resolve button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'comments.newAriaLabel' }), 'Resolve me');
    await user.click(screen.getByText('comments.add'));
    await user.click(screen.getByText('comments.resolve'));
    expect(screen.getByText('comments.resolved')).toBeInTheDocument();
  });

  it('deletes a comment when delete button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'comments.newAriaLabel' }), 'Delete me');
    await user.click(screen.getByText('comments.add'));
    await user.click(screen.getByText('comments.delete'));
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
  });

  it('expands reply input when reply button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'comments.newAriaLabel' }), 'A comment');
    await user.click(screen.getByText('comments.add'));
    await user.click(screen.getByText('comments.reply'));
    expect(screen.getByText('comments.send')).toBeInTheDocument();
  });

  it('adds a reply via send button', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'comments.newAriaLabel' }), 'Parent');
    await user.click(screen.getByText('comments.add'));
    await user.click(screen.getByText('comments.reply'));
    // Reply input is the last textbox
    const replyInputs = screen.getAllByRole('textbox');
    const replyInput = replyInputs[replyInputs.length - 1];
    await user.type(replyInput, 'My reply');
    await user.click(screen.getByText('comments.send'));
    expect(screen.getByText('My reply')).toBeInTheDocument();
  });

  it('shows unresolved count badge when comments are unresolved', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'comments.newAriaLabel' }), 'Unresolved');
    await user.click(screen.getByText('comments.add'));
    // Should show badge with unresolved count
    expect(screen.getByText(/comments\.unresolved/)).toBeInTheDocument();
  });
});
