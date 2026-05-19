import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet } from '../../components/ui/BottomSheet';

const renderSheet = (overrides: Partial<Parameters<typeof BottomSheet>[0]> = {}) => {
  const onClose = vi.fn();
  const { rerender } = render(
    <BottomSheet open={true} onClose={onClose} title="Test Sheet" {...overrides}>
      <button type="button">Action One</button>
      <button type="button">Action Two</button>
    </BottomSheet>,
  );
  return { onClose, rerender };
};

describe('BottomSheet', () => {
  it('renders with role="dialog" and aria-modal="true" when open', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders the title and connects it via aria-labelledby', () => {
    renderSheet();
    const title = screen.getByText('Test Sheet');
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(title.id).toBe(labelledBy);
  });

  it('renders children', () => {
    renderSheet();
    expect(screen.getByText('Action One')).toBeInTheDocument();
    expect(screen.getByText('Action Two')).toBeInTheDocument();
  });

  it('does NOT render when open=false', () => {
    renderSheet({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const { onClose } = renderSheet();
    // The backdrop has aria-hidden; find it by its onClick behaviour
    const backdrop = document.querySelector('.bg-black\\/40') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps focus — Tab wraps from last to first focusable element', async () => {
    const user = userEvent.setup();
    renderSheet();
    const buttons = screen.getAllByRole('button');
    // Focus the last button then Tab
    buttons[buttons.length - 1]!.focus();
    await user.tab();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('traps focus — Shift+Tab wraps from first to last focusable element', async () => {
    const user = userEvent.setup();
    renderSheet();
    const buttons = screen.getAllByRole('button');
    buttons[0]!.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('applies half height class by default', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/h-\[50dvh\]/);
  });

  it('applies full height class when height="full"', () => {
    renderSheet({ height: 'full' });
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/h-\[92dvh\]/);
  });
});
