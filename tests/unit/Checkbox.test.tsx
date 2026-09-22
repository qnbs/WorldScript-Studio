/**
 * Tests for components/ui/Checkbox.tsx
 * QNBS-v3: Pure UI atom; tests render, label, checked state, onChange, forwardRef.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../components/ui/Checkbox';

describe('Checkbox', () => {
  it('renders a checkbox input', () => {
    render(<Checkbox />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders the label when provided', () => {
    render(<Checkbox id="chk-1" label="Enable feature" />);
    expect(screen.getByText('Enable feature')).toBeInTheDocument();
  });

  it('associates label with checkbox via id', () => {
    render(<Checkbox id="chk-2" label="My option" />);
    const label = screen.getByText('My option');
    expect(label).toHaveAttribute('for', 'chk-2');
  });

  it('renders as checked when checked prop is true', () => {
    render(<Checkbox checked onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('renders as unchecked when checked prop is false', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('calls onChange when clicked', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox onChange={handleChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(handleChange).toHaveBeenCalled();
  });

  it('does not render label element when label is not provided', () => {
    render(<Checkbox id="chk-3" />);
    expect(screen.queryByRole('label')).not.toBeInTheDocument();
  });

  it('is disabled when disabled prop is set', () => {
    render(<Checkbox disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('forwards ref to the input element', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  // QNBS-v3 (Visual Maturity #B): locks the solid-surface treatment — no blurred glass panel.
  it('renders on a solid surface token, without backdrop-blur', () => {
    render(<Checkbox />);
    const className = screen.getByRole('checkbox').className;
    expect(className).toContain('bg-[var(--sc-surface-overlay)]');
    expect(className).not.toContain('backdrop-blur');
  });

  // QNBS-v3 (CodeAnt, Visual Maturity #B): locks the checked:hover: compound variant so an opaque hover background can never visually un-fill a checked box, regardless of Tailwind's variant emission order.
  it('keeps the accent fill on hover while checked', () => {
    render(<Checkbox checked onChange={vi.fn()} />);
    const className = screen.getByRole('checkbox').className;
    expect(className).toContain('checked:hover:bg-[var(--sc-accent)]');
    expect(className).toContain('checked:hover:border-[var(--sc-accent)]');
  });
});
