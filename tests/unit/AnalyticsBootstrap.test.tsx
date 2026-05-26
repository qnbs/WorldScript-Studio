/**
 * Tests for components/AnalyticsBootstrap.tsx
 * QNBS-v3: Thin component that only calls useDuckDb() and renders null.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseDuckDb = vi.fn();

vi.mock('../../hooks/useDuckDb', () => ({
  useDuckDb: () => {
    mockUseDuckDb();
    return {};
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { AnalyticsBootstrap } from '../../components/AnalyticsBootstrap';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing (null component)', () => {
    const { container } = render(<AnalyticsBootstrap />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls useDuckDb on mount', () => {
    render(<AnalyticsBootstrap />);
    expect(mockUseDuckDb).toHaveBeenCalledTimes(1);
  });
});
