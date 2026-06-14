/**
 * Tests for components/ui/RadioGroup.tsx
 * QNBS-v3: Accessible radiogroup atom — render, checked state, onChange, disabled, description, orientation.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup } from '../../components/ui/RadioGroup';

const OPTIONS = [
  { value: 'a', label: 'Option A', description: 'First choice' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C', disabled: true },
];

describe('RadioGroup', () => {
  it('renders a radiogroup with each option label and description', () => {
    render(<RadioGroup options={OPTIONS} value="a" onChange={vi.fn()} name="choices" />);
    expect(screen.getByRole('radiogroup', { name: 'choices' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Option A' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeInTheDocument();
    expect(screen.getByText('First choice')).toBeInTheDocument();
  });

  it('marks the option matching value as checked', () => {
    render(<RadioGroup options={OPTIONS} value="b" onChange={vi.fn()} name="choices" />);
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Option A' })).not.toBeChecked();
  });

  it('calls onChange with the option value when an option is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioGroup options={OPTIONS} value="a" onChange={onChange} name="choices" />);
    await user.click(screen.getByRole('radio', { name: 'Option B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('renders disabled options as disabled and does not fire onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioGroup options={OPTIONS} value="a" onChange={onChange} name="choices" />);
    const disabled = screen.getByRole('radio', { name: 'Option C' });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies horizontal orientation layout', () => {
    render(
      <RadioGroup
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        name="choices"
        orientation="horizontal"
      />,
    );
    expect(screen.getByRole('radiogroup').className).toContain('flex-row');
  });

  it('defaults to vertical orientation', () => {
    render(<RadioGroup options={OPTIONS} value="a" onChange={vi.fn()} name="choices" />);
    expect(screen.getByRole('radiogroup').className).toContain('flex-col');
  });
});
