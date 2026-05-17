import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRegionProvider, useAnnounce } from '../../contexts/LiveRegionContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { accessibility: { liveRegionVerbosity: 'full' } } }),
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <LiveRegionProvider>{children}</LiveRegionProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LiveRegionProvider', () => {
  it('renders aria-live regions', () => {
    const { container } = render(
      <LiveRegionProvider>
        <span />
      </LiveRegionProvider>,
    );
    const politeRegion = container.querySelector('[aria-live="polite"]');
    const assertiveRegion = container.querySelector('[aria-live="assertive"]');
    expect(politeRegion).toBeTruthy();
    expect(assertiveRegion).toBeTruthy();
  });

  it('renders children', () => {
    render(
      <LiveRegionProvider>
        <span data-testid="child">hello</span>
      </LiveRegionProvider>,
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('announces a polite message via requestAnimationFrame', async () => {
    const { result } = renderHook(() => useAnnounce(), { wrapper });
    act(() => {
      result.current('hello world');
    });
    // flush both rAF callbacks
    await act(async () => {
      vi.runAllTimers();
    });
    const politeRegion = document.querySelector('[aria-live="polite"]');
    expect(politeRegion?.textContent).toBe('hello world');
  });

  it('announces an assertive message', async () => {
    const { result } = renderHook(() => useAnnounce(), { wrapper });
    act(() => {
      result.current('urgent!', 'assertive');
    });
    await act(async () => {
      vi.runAllTimers();
    });
    const assertiveRegion = document.querySelector('[aria-live="assertive"]');
    expect(assertiveRegion?.textContent).toBe('urgent!');
  });

  it('ignores empty / whitespace-only messages', async () => {
    const { result } = renderHook(() => useAnnounce(), { wrapper });
    act(() => {
      result.current('   ');
    });
    await act(async () => {
      vi.runAllTimers();
    });
    const politeRegion = document.querySelector('[aria-live="polite"]');
    expect(politeRegion?.textContent).toBe('');
  });
});

describe('useAnnounce throws outside provider', () => {
  it('throws when used without LiveRegionProvider', () => {
    expect(() => renderHook(() => useAnnounce())).toThrow(
      'useAnnounce must be used within LiveRegionProvider',
    );
  });
});
