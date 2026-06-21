/**
 * Tests for components/copilot/InsightSection.tsx — collapsible heuristic-findings section.
 * QNBS-v3: collapsed by default; expands on click; caps at 5 visible; force-expands via the
 * transient-store flag set by InlineAnnotationLayer; announces new insights politely.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAnnounce, mockSetExpanded } = vi.hoisted(() => ({
  mockAnnounce: vi.fn(),
  mockSetExpanded: vi.fn(),
}));

let mockForceExpand = false;

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (
    sel: (s: {
      copilotInsightExpanded: boolean;
      setCopilotInsightExpanded: (v: boolean) => void;
    }) => unknown,
  ) => sel({ copilotInsightExpanded: mockForceExpand, setCopilotInsightExpanded: mockSetExpanded }),
}));

vi.mock('../../../contexts/LiveRegionContext', () => ({
  useAnnounce: () => mockAnnounce,
}));

vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));

vi.mock('../../../components/copilot/InsightCard', () => ({
  InsightCard: ({ finding }: { finding: { id: string } }) => (
    <div data-testid="insight-card">{finding.id}</div>
  ),
}));

import { InsightSection } from '../../../components/copilot/InsightSection';

const copilot = {
  t: (k: string, p?: { count?: number }) => `${k}:${p?.count ?? ''}`,
  sendMessage: vi.fn(),
  heuristicsOnly: false,
} as never;

const findings = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, severity: 'info', params: {} })) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockForceExpand = false;
});

describe('InsightSection', () => {
  it('renders nothing when there are no insights', () => {
    const { container } = render(<InsightSection insights={[]} copilot={copilot} />);
    expect(container.firstChild).toBeNull();
  });

  it('is collapsed by default — header shows the count, cards are hidden', () => {
    render(<InsightSection insights={findings(3)} copilot={copilot} />);
    expect(screen.getByText('copilot.insightSection:3')).toBeInTheDocument();
    expect(screen.queryByTestId('insight-card')).toBeNull();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands on click to reveal the insight cards', async () => {
    const user = userEvent.setup();
    render(<InsightSection insights={findings(3)} copilot={copilot} />);
    await user.click(screen.getByRole('button', { name: /copilot.insightSection/ }));
    expect(screen.getAllByTestId('insight-card')).toHaveLength(3);
  });

  it('caps visible cards at 5 even when more insights exist', async () => {
    const user = userEvent.setup();
    render(<InsightSection insights={findings(9)} copilot={copilot} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getAllByTestId('insight-card')).toHaveLength(5);
  });

  it('auto-expands and resets the flag when force-expand is set', () => {
    mockForceExpand = true;
    render(<InsightSection insights={findings(2)} copilot={copilot} />);
    expect(screen.getAllByTestId('insight-card')).toHaveLength(2);
    expect(mockSetExpanded).toHaveBeenCalledWith(false);
  });

  it('announces politely when new insights arrive', () => {
    render(<InsightSection insights={findings(2)} copilot={copilot} />);
    expect(mockAnnounce).toHaveBeenCalledWith('copilot.insightSection:2', 'polite');
  });
});
