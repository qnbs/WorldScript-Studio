import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recordTelemetry: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('../../services/ai/telemetryService', () => ({
  recordInferenceTelemetry: mocks.recordTelemetry,
}));

import { AssistedModeBadge } from '../../components/ui/AssistedModeBadge';
import { useHeuristicFallback } from '../../hooks/useHeuristicFallback';
import {
  _resetHeuristicFallbackEvents,
  recordHeuristicFallback,
} from '../../services/ai/heuristicFallback';

const event = {
  task: 'outline',
  reasonKey: 'error.fallback.offline',
  confidence: 0.6,
  tier: 'advanced' as const,
  at: 42,
};

describe('AssistedModeBadge', () => {
  it('renders nothing when there is no fallback event', () => {
    const { container } = render(<AssistedModeBadge event={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the assisted label when an event is present', () => {
    render(<AssistedModeBadge event={event} />);
    expect(screen.getByText('assisted.badge.label')).toBeTruthy();
  });
});

describe('useHeuristicFallback', () => {
  beforeEach(() => {
    _resetHeuristicFallbackEvents();
    mocks.recordTelemetry.mockClear();
  });

  it('updates with the latest event and records telemetry', () => {
    const { result } = renderHook(() => useHeuristicFallback());
    expect(result.current).toBeNull();

    act(() => {
      recordHeuristicFallback(event);
    });

    expect(result.current).toEqual(event);
    expect(mocks.recordTelemetry).toHaveBeenCalledWith({
      taskType: 'heuristic:outline',
      backend: 'heuristic',
      modelId: 'error.fallback.offline',
      latencyMs: 0,
      success: true,
      timestamp: 42,
    });
  });
});
