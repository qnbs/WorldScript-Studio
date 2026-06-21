/**
 * Tests for components/copilot/CopilotPanel.tsx — the Copilot dialog/sidebar shell.
 * QNBS-v3: child components + focus trap are mocked to isolate the panel's own behaviour
 * (close/clear/Escape, suggestion chips when empty, error + apply-status banners).
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (sel: (s: { activeSectionId: string | null }) => unknown) =>
    sel({ activeSectionId: null }),
}));
vi.mock('../../../hooks/useFocusTrap', () => ({ useFocusTrap: () => undefined }));
vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../components/copilot/AiModeIndicator', () => ({ AiModeIndicator: () => null }));
vi.mock('../../../components/copilot/CopilotMessageList', () => ({
  CopilotMessageList: () => <div data-testid="message-list" />,
}));
vi.mock('../../../components/copilot/CopilotComposer', () => ({
  CopilotComposer: () => <div data-testid="composer" />,
}));
vi.mock('../../../components/copilot/HeuristicsModeToggle', () => ({
  HeuristicsModeToggle: () => <div data-testid="heuristics-toggle" />,
}));
vi.mock('../../../components/copilot/InsightSection', () => ({
  InsightSection: () => <div data-testid="insight-section" />,
}));

import { CopilotPanel } from '../../../components/copilot/CopilotPanel';
import type { UseGlobalCopilotReturn } from '../../../hooks/useGlobalCopilot';

function makeCopilot(over: Record<string, unknown> = {}): UseGlobalCopilotReturn {
  return {
    t: (k: string) => k,
    messages: [],
    status: 'idle',
    error: null,
    suggestions: [],
    proactiveInsights: [],
    heuristicsOnly: false,
    sendMessage: vi.fn(),
    close: vi.fn(),
    clear: vi.fn(),
    toggleHeuristicsOnly: vi.fn(),
    applyLastSuggestion: vi.fn(),
    applyStatus: 'idle',
    ...over,
  } as unknown as UseGlobalCopilotReturn;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('CopilotPanel', () => {
  it('renders a modal dialog labelled with the Copilot title + context label', () => {
    render(<CopilotPanel copilot={makeCopilot()} contextLabel="Writing • Manuscript" />);
    const dialog = screen.getByRole('dialog', { name: 'copilot.title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Writing • Manuscript')).toBeInTheDocument();
  });

  it('calls close when the close button is clicked', async () => {
    const user = userEvent.setup();
    const copilot = makeCopilot();
    render(<CopilotPanel copilot={copilot} contextLabel="ctx" />);
    await user.click(screen.getByRole('button', { name: 'copilot.closeLabel' }));
    expect(copilot.close).toHaveBeenCalledTimes(1);
  });

  it('calls clear when the clear button is clicked', async () => {
    const user = userEvent.setup();
    const copilot = makeCopilot();
    render(<CopilotPanel copilot={copilot} contextLabel="ctx" />);
    await user.click(screen.getByRole('button', { name: 'copilot.clear' }));
    expect(copilot.clear).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const copilot = makeCopilot();
    render(<CopilotPanel copilot={copilot} contextLabel="ctx" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(copilot.close).toHaveBeenCalledTimes(1);
  });

  it('renders suggestion chips when there are no messages and sends on click', async () => {
    const user = userEvent.setup();
    const copilot = makeCopilot({ suggestions: ['Summarize', 'Improve pacing'] });
    render(<CopilotPanel copilot={copilot} contextLabel="ctx" />);
    await user.click(screen.getByRole('button', { name: 'Summarize' }));
    expect(copilot.sendMessage).toHaveBeenCalledWith('Summarize');
  });

  it('hides suggestion chips once a message exists', () => {
    const copilot = makeCopilot({
      suggestions: ['Summarize'],
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
    });
    render(<CopilotPanel copilot={copilot} contextLabel="ctx" />);
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull();
  });

  it('shows an error alert when copilot.error is set', () => {
    render(<CopilotPanel copilot={makeCopilot({ error: 'boom' })} contextLabel="ctx" />);
    expect(screen.getByRole('alert')).toHaveTextContent('copilot.error');
  });

  it('shows a success status banner when applyStatus is success', () => {
    render(<CopilotPanel copilot={makeCopilot({ applyStatus: 'success' })} contextLabel="ctx" />);
    expect(screen.getByRole('status')).toHaveTextContent('copilot.changeApplied');
  });

  it('shows an error alert when applyStatus is error', () => {
    render(<CopilotPanel copilot={makeCopilot({ applyStatus: 'error' })} contextLabel="ctx" />);
    expect(screen.getByRole('alert')).toHaveTextContent('copilot.changeApplyFailed');
  });
});
