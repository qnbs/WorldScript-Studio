/**
 * Tests for components/copilot/CopilotMessageList.tsx
 * QNBS-v3: empty state, user plain-text vs assistant markdown, DOMPurify sanitization, pending
 * spinner, and the "Apply to chapter" button gating + code-block extraction.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotMessageList } from '../../../components/copilot/CopilotMessageList';
import type { CopilotMessage } from '../../../features/copilot/copilotSlice';

vi.mock('../../../components/ui/Spinner', () => ({
  Spinner: () => <div data-testid="copilot-spinner" />,
}));

// jsdom does not implement scrollIntoView (called in the auto-scroll effect). Stub it, then restore
// the original in afterAll so this prototype patch can't leak into other suites (CodeAnt #136).
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

let idCounter = 0;
function msg(role: 'user' | 'assistant', content: string, pending = false): CopilotMessage {
  idCounter += 1;
  return { id: `m${idCounter}`, role, content, createdAt: '2026-01-01T00:00:00Z', pending };
}

const baseProps = {
  emptyTitle: 'No messages yet',
  emptyBody: 'Ask the Co-Pilot anything',
  youLabel: 'You',
  assistantLabel: 'Co-Pilot',
  applyLabel: 'Apply to chapter',
  applyingLabel: 'Applying…',
  hasActiveSection: false,
  applyStatus: 'idle' as const,
};

function md(container: HTMLElement): string {
  return container.querySelector('.prose-copilot')?.innerHTML ?? '';
}

beforeEach(() => {
  idCounter = 0;
});

describe('CopilotMessageList', () => {
  it('renders the empty state when there are no messages', () => {
    render(<CopilotMessageList {...baseProps} messages={[]} />);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(screen.getByText('Ask the Co-Pilot anything')).toBeInTheDocument();
  });

  it('renders a user message as plain text with the You label', () => {
    render(<CopilotMessageList {...baseProps} messages={[msg('user', 'hello <b>there</b>')]} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    // Angle brackets are shown literally, not parsed as HTML.
    expect(screen.getByText('hello <b>there</b>')).toBeInTheDocument();
  });

  it('renders assistant markdown (bold, heading, list, inline code, code block) as HTML', () => {
    const content = '# Title\n**bold** and `code`\n- item one\n```\nconst x = 1;\n```';
    const { container } = render(
      <CopilotMessageList {...baseProps} messages={[msg('assistant', content)]} />,
    );
    const html = md(container);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<pre');
    expect(html).toContain('const x = 1;');
    // heading '# Title' renders as a semibold paragraph (not plain text)
    expect(html).toMatch(/font-semibold[^>]*>Title/);
    expect(screen.getByText('Co-Pilot')).toBeInTheDocument();
  });

  it('sanitizes dangerous HTML in assistant content (DOMPurify allowlist)', () => {
    const content = 'before <script>alert(1)</script> <img src=x onerror=alert(2)> after';
    const { container } = render(
      <CopilotMessageList {...baseProps} messages={[msg('assistant', content)]} />,
    );
    const html = md(container);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    // safe surrounding text must survive sanitization (guards against over-stripping)
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  it('shows a spinner for a pending assistant message with no content', () => {
    render(<CopilotMessageList {...baseProps} messages={[msg('assistant', '', true)]} />);
    expect(screen.getByTestId('copilot-spinner')).toBeInTheDocument();
  });

  it('shows "Apply to chapter" on the last assistant message with a code block when a section is active', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <CopilotMessageList
        {...baseProps}
        hasActiveSection
        onApply={onApply}
        messages={[msg('assistant', 'Here:\n```\nrewritten text\n```')]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Apply to chapter' }));
    expect(onApply).toHaveBeenCalledWith('rewritten text');
  });

  it('hides the apply button without an active section', () => {
    render(
      <CopilotMessageList
        {...baseProps}
        hasActiveSection={false}
        onApply={vi.fn()}
        messages={[msg('assistant', '```\ncode\n```')]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Apply to chapter' })).toBeNull();
  });

  it('hides the apply button when the assistant message has no code block', () => {
    render(
      <CopilotMessageList
        {...baseProps}
        hasActiveSection
        onApply={vi.fn()}
        messages={[msg('assistant', 'just prose, no fence')]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Apply to chapter' })).toBeNull();
  });

  it('shows one apply button, wired to the LAST assistant message', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <CopilotMessageList
        {...baseProps}
        hasActiveSection
        onApply={onApply}
        messages={[
          msg('assistant', 'first\n```\nold\n```'),
          msg('assistant', 'second\n```\nnew\n```'),
        ]}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: 'Apply to chapter' });
    expect(buttons).toHaveLength(1);
    // Clicking applies the LAST message's code ("new"), proving placement — not "old".
    await user.click(buttons[0]!);
    expect(onApply).toHaveBeenCalledWith('new');
  });

  it('disables the apply button and shows the applying label while applying', () => {
    render(
      <CopilotMessageList
        {...baseProps}
        hasActiveSection
        applyStatus="applying"
        onApply={vi.fn()}
        messages={[msg('assistant', '```\ncode\n```')]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Applying…' });
    expect(button).toBeDisabled();
  });
});
