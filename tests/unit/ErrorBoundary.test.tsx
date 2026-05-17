import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../constants', () => ({
  ICONS: { LIGHTNING_BOLT: null },
}));

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test error');
  return <span>OK</span>;
}

// Suppress console.error for expected React boundary logs
const originalError = console.error;

beforeEach(() => {
  console.error = vi.fn();
});

afterEach(() => {
  console.error = originalError;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <span>All good</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('renders the error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong.')).toBeTruthy();
  });

  it('does not render children when error occurred', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('OK')).toBeNull();
  });

  it('calls onReset when Reset View button is clicked', () => {
    const onReset = vi.fn();
    render(
      <ErrorBoundary onReset={onReset}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset View' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('shows Reload Page button', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeTruthy();
  });

  it('does not show Reset View button when onReset is not provided', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('button', { name: 'Reset View' })).toBeNull();
  });

  it('shows the report issue button', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Report issue' })).toBeTruthy();
  });
});
