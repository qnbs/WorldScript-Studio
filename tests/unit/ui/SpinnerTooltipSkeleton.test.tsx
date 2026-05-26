/**
 * Tests for components/ui/Spinner.tsx, Tooltip.tsx, Skeleton.tsx
 * QNBS-v3: Pure render components — verifies ARIA attributes and content.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Spinner } from '../../../components/ui/Spinner';
import { Tooltip } from '../../../components/ui/Tooltip';

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

describe('Spinner', () => {
  it('has role="status"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has default aria-label "Loading…"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading…');
  });

  it('uses custom label when provided', () => {
    render(<Spinner label="Saving project…" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Saving project…');
  });

  it('renders sr-only label text', () => {
    render(<Spinner label="Processing" />);
    expect(screen.getByText('Processing')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<Spinner className="w-8 h-8" />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('w-8');
  });
});

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

describe('Tooltip', () => {
  it('renders children', () => {
    render(
      <Tooltip label="Bold">
        <button type="button">B</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument();
  });

  it('renders tooltip with role="tooltip"', () => {
    render(
      <Tooltip label="Bold">
        <button type="button">B</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('shows label text in tooltip', () => {
    render(
      <Tooltip label="Bold text">
        <button type="button">B</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bold text');
  });

  it('appends shortcut to tooltip text', () => {
    render(
      <Tooltip label="Bold" shortcut="Ctrl+B">
        <button type="button">B</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bold (Ctrl+B)');
  });

  it('wraps children in aria-describedby span', () => {
    const { container } = render(
      <Tooltip label="Hint">
        <span>Target</span>
      </Tooltip>,
    );
    const describedEl = container.querySelector('[aria-describedby]');
    expect(describedEl).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

describe('Skeleton', () => {
  it('renders a div element', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });

  it('applies animate-pulse class', () => {
    const { container } = render(<Skeleton />);
    expect((container.firstChild as HTMLElement).className).toContain('animate-pulse');
  });

  it('applies custom className', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect((container.firstChild as HTMLElement).className).toContain('h-4');
    expect((container.firstChild as HTMLElement).className).toContain('w-32');
  });
});
