/**
 * Tests for components/copilot/AiModeIndicator.tsx
 * QNBS-v3: mode chip label/dot logic — plain mode, OpenRouter active (free vs paid), circuit-open
 * suffix + pulsing dot, and OpenRouter suppression in local mode.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModeIndicator } from '../../../components/copilot/AiModeIndicator';

// `mock`-prefixed so the hoisted vi.mock factories may reference them.
let mockState: {
  settings: { aiMode?: string; openRouter?: { enabled?: boolean; preferredModel?: string } };
} = { settings: { aiMode: 'hybrid', openRouter: { enabled: false } } };
const mockIsCircuitOpen = vi.fn(() => false);
const mockGetApproxRpm = vi.fn(() => 0);
const mockIsFreeModel = vi.fn((_model: string) => false);

vi.mock('../../../app/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) => selector(mockState),
}));
vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));
vi.mock('../../../services/ai', () => ({
  isCircuitOpen: () => mockIsCircuitOpen(),
  getApproxRpm: () => mockGetApproxRpm(),
  isOpenRouterFreeModel: (m: string) => mockIsFreeModel(m),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCircuitOpen.mockReturnValue(false);
  mockGetApproxRpm.mockReturnValue(0);
  mockIsFreeModel.mockReturnValue(false);
  mockState = { settings: { aiMode: 'hybrid', openRouter: { enabled: false } } };
});

describe('AiModeIndicator', () => {
  it('renders the plain mode label when OpenRouter is disabled', () => {
    mockState = { settings: { aiMode: 'hybrid', openRouter: { enabled: false } } };
    render(<AiModeIndicator />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('settings.aiMode.indicator.hybrid');
    expect(chip).not.toHaveTextContent('·');
  });

  it('appends the OpenRouter label when OpenRouter is active (paid model)', () => {
    mockState = { settings: { aiMode: 'cloud', openRouter: { enabled: true } } };
    render(<AiModeIndicator />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('settings.aiMode.indicator.cloud');
    expect(chip).toHaveTextContent('settings.aiMode.indicator.openRouter');
  });

  it('shows the free-tier OpenRouter label for a :free model', () => {
    mockIsFreeModel.mockReturnValue(true);
    mockState = {
      settings: { aiMode: 'cloud', openRouter: { enabled: true, preferredModel: 'x/y:free' } },
    };
    render(<AiModeIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'settings.aiMode.indicator.openRouterFree',
    );
  });

  it('shows the compact circuit-open suffix and a pulsing dot when the breaker is open', () => {
    mockIsCircuitOpen.mockReturnValue(true);
    mockState = { settings: { aiMode: 'cloud', openRouter: { enabled: true } } };
    render(<AiModeIndicator />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('settings.aiMode.indicator.orShort');
    expect(chip.querySelector('span[aria-hidden="true"]')?.className).toContain('animate-pulse');
  });

  it('suppresses OpenRouter status in local mode even when enabled', () => {
    mockState = { settings: { aiMode: 'local', openRouter: { enabled: true } } };
    render(<AiModeIndicator />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('settings.aiMode.indicator.local');
    expect(chip).not.toHaveTextContent('openRouter');
  });
});
