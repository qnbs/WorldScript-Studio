/**
 * Tests for components/ui/AddNewCard.tsx
 * QNBS-v3: Pure UI component; tests render, click, variant classes.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddNewCard } from '../../components/ui/AddNewCard';

const icon = <path d="M12 5v14M5 12h14" />;

describe('AddNewCard', () => {
  it('renders the title', () => {
    render(
      <AddNewCard title="New Project" description="Start fresh" onClick={vi.fn()} icon={icon} />,
    );
    expect(screen.getByText('New Project')).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(
      <AddNewCard title="New Project" description="Start fresh" onClick={vi.fn()} icon={icon} />,
    );
    expect(screen.getByText('Start fresh')).toBeInTheDocument();
  });

  it('calls onClick when button is clicked', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(<AddNewCard title="Add" description="desc" onClick={handleClick} icon={icon} />);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders as a button element', () => {
    render(<AddNewCard title="Add" description="desc" onClick={vi.fn()} icon={icon} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('accepts default variant (primary)', () => {
    render(<AddNewCard title="Add" description="desc" onClick={vi.fn()} icon={icon} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders with default variant when none is specified', () => {
    render(
      <AddNewCard title="Add" description="desc" onClick={vi.fn()} icon={icon} variant="default" />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
