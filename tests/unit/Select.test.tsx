/**
 * Tests for components/ui/Select.tsx
 * QNBS-v3: Pure UI atom; tests render, options, onChange, forwardRef, disabled.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '../../components/ui/Select';

describe('Select', () => {
  it('renders a combobox', () => {
    render(
      <Select value="a" onChange={vi.fn()}>
        <option value="a">Option A</option>
        <option value="b">Option B</option>
      </Select>,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders the provided options', () => {
    render(
      <Select value="a" onChange={vi.fn()}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows the selected value', () => {
    render(
      <Select value="b" onChange={vi.fn()}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    expect(screen.getByRole('combobox')).toHaveValue('b');
  });

  it('calls onChange when selection changes', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select value="a" onChange={handleChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'b');
    expect(handleChange).toHaveBeenCalled();
  });

  it('renders as disabled when disabled prop is set', () => {
    render(
      <Select value="a" onChange={vi.fn()} disabled>
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('forwards ref to the select element', () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(
      <Select ref={ref} value="a" onChange={vi.fn()}>
        <option value="a">A</option>
      </Select>,
    );
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });
});
