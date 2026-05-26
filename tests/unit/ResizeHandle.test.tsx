/**
 * Tests for components/manuscript/ResizeHandle.tsx — Resizer component.
 * QNBS-v3: Pure UI, keyboard + pointer interactions, ARIA semantics.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Resizer } from '../../components/manuscript/ResizeHandle';

const DEFAULT_PROPS = {
  label: 'Resize panel',
  value: 30,
  onPointerDown: vi.fn(),
  onKeyAdjust: vi.fn(),
};

describe('Resizer', () => {
  it('renders with role="separator"', () => {
    render(<Resizer {...DEFAULT_PROPS} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('has correct aria-label', () => {
    render(<Resizer {...DEFAULT_PROPS} />);
    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('Resize panel');
  });

  it('has aria-orientation="vertical"', () => {
    render(<Resizer {...DEFAULT_PROPS} />);
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical');
  });

  it('reflects value as aria-valuenow', () => {
    render(<Resizer {...DEFAULT_PROPS} value={45} />);
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('45');
  });

  it('rounds aria-valuenow', () => {
    render(<Resizer {...DEFAULT_PROPS} value={33.7} />);
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('34');
  });

  it('has aria-valuemin=15 and aria-valuemax=50', () => {
    render(<Resizer {...DEFAULT_PROPS} />);
    const sep = screen.getByRole('separator');
    expect(sep.getAttribute('aria-valuemin')).toBe('15');
    expect(sep.getAttribute('aria-valuemax')).toBe('50');
  });

  it('is keyboard focusable (tabIndex=0)', () => {
    render(<Resizer {...DEFAULT_PROPS} />);
    expect(screen.getByRole('separator').getAttribute('tabindex')).toBe('0');
  });

  it('calls onKeyAdjust(-2) on ArrowLeft', async () => {
    const onKeyAdjust = vi.fn();
    const user = userEvent.setup();
    render(<Resizer {...DEFAULT_PROPS} onKeyAdjust={onKeyAdjust} />);
    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowLeft}');
    expect(onKeyAdjust).toHaveBeenCalledWith(-2);
  });

  it('calls onKeyAdjust(2) on ArrowRight', async () => {
    const onKeyAdjust = vi.fn();
    const user = userEvent.setup();
    render(<Resizer {...DEFAULT_PROPS} onKeyAdjust={onKeyAdjust} />);
    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowRight}');
    expect(onKeyAdjust).toHaveBeenCalledWith(2);
  });

  it('does not call onKeyAdjust on other keys', async () => {
    const onKeyAdjust = vi.fn();
    const user = userEvent.setup();
    render(<Resizer {...DEFAULT_PROPS} onKeyAdjust={onKeyAdjust} />);
    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowUp}');
    expect(onKeyAdjust).not.toHaveBeenCalled();
  });
});
