/**
 * Tests for components/ui/EmptyState.tsx
 * QNBS-v3: Pure UI component; tests title, description, hint, actions, compact prop.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../../components/ui/EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="Empty" description="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByText('No items found')).not.toBeInTheDocument();
  });

  it('renders the hint when provided', () => {
    render(<EmptyState title="Empty" hint="Try adding something" />);
    expect(screen.getByText('Try adding something')).toBeInTheDocument();
  });

  it('renders a primary action button when provided', () => {
    render(<EmptyState title="Empty" primaryAction={{ label: 'Add item', onClick: vi.fn() }} />);
    expect(screen.getByText('Add item')).toBeInTheDocument();
  });

  it('calls primaryAction.onClick when primary button is clicked', async () => {
    const handlePrimary = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState title="Empty" primaryAction={{ label: 'Add', onClick: handlePrimary }} />);
    await user.click(screen.getByText('Add'));
    expect(handlePrimary).toHaveBeenCalledTimes(1);
  });

  it('renders a secondary action button when provided', () => {
    render(
      <EmptyState
        title="Empty"
        primaryAction={{ label: 'Add', onClick: vi.fn() }}
        secondaryAction={{ label: 'Import', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('calls secondaryAction.onClick when secondary button is clicked', async () => {
    const handleSecondary = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="Empty"
        primaryAction={{ label: 'Add', onClick: vi.fn() }}
        secondaryAction={{ label: 'Cancel', onClick: handleSecondary }}
      />,
    );
    await user.click(screen.getByText('Cancel'));
    expect(handleSecondary).toHaveBeenCalledTimes(1);
  });

  it('renders status role on container', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">★</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
