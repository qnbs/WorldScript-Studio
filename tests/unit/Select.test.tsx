/**
 * Tests for components/ui/Select.tsx
 * QNBS-v3: Custom dropdown Select atom; tests render, options, onChange, disabled.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { describe, expect, it, vi } from 'vitest';
import { Select } from '../../components/ui/Select';

const OPTIONS = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
];

describe('Select', () => {
  it('renders the trigger button with selected label', () => {
    render(<Select value="a" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('button', { name: /Option A/i })).toBeInTheDocument();
  });

  it('renders the provided options when opened', async () => {
    const user = userEvent.setup();
    render(<Select value="a" onChange={vi.fn()} options={OPTIONS} ariaLabel="Test" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: 'Option A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option B' })).toBeInTheDocument();
  });

  it('shows the selected value in the trigger', () => {
    render(<Select value="b" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('button')).toHaveTextContent('Option B');
  });

  it('calls onChange when an option is clicked', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="a" onChange={handleChange} options={OPTIONS} ariaLabel="Test" />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: 'Option B' }));
    expect(handleChange).toHaveBeenCalledWith('b');
  });

  it('renders as disabled when disabled prop is set', () => {
    render(<Select value="a" onChange={vi.fn()} options={OPTIONS} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders groups when provided', async () => {
    const user = userEvent.setup();
    render(
      <Select
        value="a"
        onChange={vi.fn()}
        groups={[
          { label: 'Group 1', options: [{ value: 'a', label: 'A' }] },
          { label: 'Group 2', options: [{ value: 'b', label: 'B' }] },
        ]}
        ariaLabel="Test"
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Group 1')).toBeInTheDocument();
    expect(screen.getByText('Group 2')).toBeInTheDocument();
  });

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup();
    render(<Select value="a" onChange={vi.fn()} options={OPTIONS} ariaLabel="Test" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
