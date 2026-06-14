/**
 * Tests for components/copilot/CopilotComposer.tsx
 * QNBS-v3: Enter sends / Shift+Enter newline; send gated on non-empty + not streaming;
 * consumes a transient-store draft once then clears it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotComposer } from '../../../components/copilot/CopilotComposer';

// `mock`-prefixed so the hoisted vi.mock factory may reference them.
let mockDraft: string | null = null;
const mockSetDraft = vi.fn((m: string | null) => {
  mockDraft = m;
});

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (selector: (s: unknown) => unknown) =>
    selector({ copilotDraftMessage: mockDraft, setCopilotDraftMessage: mockSetDraft }),
}));

vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));

const baseProps = {
  placeholder: 'Ask the Co-Pilot',
  sendLabel: 'Send',
  isStreaming: false,
  onSend: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDraft = null;
});

describe('CopilotComposer', () => {
  it('sends the trimmed value on Enter and clears the input', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<CopilotComposer {...baseProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: 'Ask the Co-Pilot' });
    await user.type(textarea, '  hello world  {Enter}');
    expect(onSend).toHaveBeenCalledWith('hello world');
    expect(textarea).toHaveValue('');
  });

  it('inserts a newline (does not send) on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<CopilotComposer {...baseProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toContain('\n');
  });

  it('disables the send button when empty and enables it once text is entered', async () => {
    const user = userEvent.setup();
    render(<CopilotComposer {...baseProps} />);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'hi');
    expect(button).toBeEnabled();
  });

  it('does not send while streaming', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<CopilotComposer {...baseProps} isStreaming onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('prefills from a transient-store draft and clears it once consumed', () => {
    mockDraft = 'drafted question';
    render(<CopilotComposer {...baseProps} />);
    expect(screen.getByRole('textbox')).toHaveValue('drafted question');
    expect(mockSetDraft).toHaveBeenCalledWith(null);
  });
});
