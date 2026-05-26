/**
 * Tests for components/settings/SettingsShared.tsx — ToggleSwitch atom.
 * QNBS-v3: Pure UI, no context/Redux deps.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToggleSwitch } from '../../components/settings/SettingsShared';

describe('ToggleSwitch', () => {
  it('renders a switch role button', () => {
    render(<ToggleSwitch checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('aria-checked=false when unchecked', () => {
    render(<ToggleSwitch checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });

  it('aria-checked=true when checked', () => {
    render(<ToggleSwitch checked={true} onChange={vi.fn()} />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('renders label text when provided', () => {
    render(<ToggleSwitch label="Enable Feature" checked={false} onChange={vi.fn()} />);
    expect(screen.getByText('Enable Feature')).toBeInTheDocument();
  });

  it('does not render label element when label is omitted', () => {
    const { container } = render(<ToggleSwitch checked={false} onChange={vi.fn()} />);
    expect(container.querySelector('span.text-sm')).toBeNull();
  });

  it('calls onChange with true when clicked while unchecked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ToggleSwitch checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with false when clicked while checked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ToggleSwitch checked={true} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('uses ariaLabel prop when provided', () => {
    render(<ToggleSwitch checked={false} onChange={vi.fn()} ariaLabel="Custom label" />);
    expect(screen.getByRole('switch').getAttribute('aria-label')).toBe('Custom label');
  });

  it('uses label as aria-label when ariaLabel is not provided', () => {
    render(<ToggleSwitch checked={false} onChange={vi.fn()} label="My Toggle" />);
    expect(screen.getByRole('switch').getAttribute('aria-label')).toBe('My Toggle');
  });
});
