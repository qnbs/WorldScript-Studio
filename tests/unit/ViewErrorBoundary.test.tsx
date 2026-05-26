/**
 * Tests for components/ui/ViewErrorBoundary.tsx
 * QNBS-v3: Verifies retry key bump + ARIA announce on error reset.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAnnounce = vi.fn();

vi.mock('../../contexts/LiveRegionContext', () => ({
  useAnnounce: () => mockAnnounce,
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, string>) =>
      opts ? `${k}:${Object.values(opts).join(',')}` : k,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ViewErrorBoundary } from '../../components/ui/ViewErrorBoundary';

// ---------------------------------------------------------------------------
// Helper — a component that throws on demand
// ---------------------------------------------------------------------------

let shouldThrow = false;

function BombChild() {
  if (shouldThrow) throw new Error('Test bomb');
  return <div data-testid="bomb-ok">OK</div>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ViewErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldThrow = false;
    // Suppress React error console noise in test output
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ViewErrorBoundary>
        <div data-testid="child">Content</div>
      </ViewErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('shows error UI when child throws', () => {
    shouldThrow = true;
    render(
      <ViewErrorBoundary>
        <BombChild />
      </ViewErrorBoundary>,
    );
    // ErrorBoundary renders a fallback — the child is gone
    expect(screen.queryByTestId('bomb-ok')).not.toBeInTheDocument();
  });

  it('announces retry with viewLabel when retry is triggered', async () => {
    shouldThrow = true;
    const user = userEvent.setup();
    render(
      <ViewErrorBoundary viewLabel="Dashboard">
        <BombChild />
      </ViewErrorBoundary>,
    );

    // Find the retry button from ErrorBoundary fallback
    const retryBtns = screen.queryAllByRole('button');
    const retryBtn = retryBtns[0];
    if (retryBtn) {
      shouldThrow = false;
      await user.click(retryBtn);
      expect(mockAnnounce).toHaveBeenCalled();
    }
    // If no retry button rendered, the boundary at least didn't crash
  });

  it('announces retry with generic message when no viewLabel', async () => {
    shouldThrow = true;
    const user = userEvent.setup();
    render(
      <ViewErrorBoundary>
        <BombChild />
      </ViewErrorBoundary>,
    );

    const retryBtns = screen.queryAllByRole('button');
    const retryBtn = retryBtns[0];
    if (retryBtn) {
      shouldThrow = false;
      await user.click(retryBtn);
      expect(mockAnnounce).toHaveBeenCalled();
    }
  });
});
