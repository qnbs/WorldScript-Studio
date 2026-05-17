import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from '../../components/ui/Drawer';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drawer', () => {
  it('renders the dialog element', () => {
    render(
      <Drawer isOpen title="My Drawer" onClose={vi.fn()}>
        <span>content</span>
      </Drawer>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('renders the title', () => {
    render(
      <Drawer isOpen title="Settings" onClose={vi.fn()}>
        <span />
      </Drawer>,
    );
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('renders children', () => {
    render(
      <Drawer isOpen title="T" onClose={vi.fn()}>
        <span data-testid="child">inner</span>
      </Drawer>,
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Drawer isOpen title="T" onClose={onClose}>
        <span />
      </Drawer>,
    );
    fireEvent.click(screen.getByLabelText('common.close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer isOpen title="T" onClose={onClose}>
        <span />
      </Drawer>,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Drawer isOpen title="T" onClose={onClose}>
        <span />
      </Drawer>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose on other keypresses', () => {
    const onClose = vi.fn();
    render(
      <Drawer isOpen title="T" onClose={onClose}>
        <span />
      </Drawer>,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sets body overflow hidden when open', () => {
    render(
      <Drawer isOpen title="T" onClose={vi.fn()}>
        <span />
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body overflow when closed', () => {
    const { rerender } = render(
      <Drawer isOpen title="T" onClose={vi.fn()}>
        <span />
      </Drawer>,
    );
    rerender(
      <Drawer isOpen={false} title="T" onClose={vi.fn()}>
        <span />
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('renders in right position when position="right"', () => {
    render(
      <Drawer isOpen title="T" onClose={vi.fn()} position="right">
        <span />
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('right-0');
  });
});
