/**
 * Tests for components/copilot/InsightCard.tsx
 * QNBS-v3: props-only presentational card — title/desc render, severity, Tell-me-more (gated by
 * heuristicsOnly), Open-view (gated by actionable + onNavigate).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InsightCard } from '../../../components/copilot/InsightCard';
import type { UseGlobalCopilotReturn } from '../../../hooks/useGlobalCopilot';
import type { HeuristicFinding } from '../../../services/copilot/heuristicEngine';

function makeFinding(overrides: Partial<HeuristicFinding> = {}): HeuristicFinding {
  return {
    id: 'f1',
    ruleId: 'tension-drop',
    severity: 'warning',
    titleKey: 'copilot.rule.tension.title',
    descriptionKey: 'copilot.rule.tension.desc',
    params: {},
    targetView: 'manuscript',
    actionable: true,
    ...overrides,
  };
}

function makeCopilot(heuristicsOnly = false) {
  return {
    t: ((key: string) => key) as UseGlobalCopilotReturn['t'],
    sendMessage: vi.fn(),
    heuristicsOnly,
  };
}

describe('InsightCard', () => {
  it('renders the localized title and description', () => {
    render(<InsightCard finding={makeFinding()} copilot={makeCopilot()} />);
    expect(screen.getByText('copilot.rule.tension.title')).toBeInTheDocument();
    expect(screen.getByText('copilot.rule.tension.desc')).toBeInTheDocument();
  });

  it('shows "Tell me more" and calls sendMessage with the finding context', async () => {
    const user = userEvent.setup();
    const copilot = makeCopilot(false);
    render(<InsightCard finding={makeFinding()} copilot={copilot} />);
    await user.click(screen.getByRole('button', { name: 'copilot.insightTellMore' }));
    expect(copilot.sendMessage).toHaveBeenCalledTimes(1);
    expect(copilot.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('copilot.rule.tension.title'),
    );
  });

  it('hides "Tell me more" in heuristics-only mode', () => {
    render(<InsightCard finding={makeFinding()} copilot={makeCopilot(true)} />);
    expect(screen.queryByRole('button', { name: 'copilot.insightTellMore' })).toBeNull();
  });

  it('shows "Open view" and calls onNavigate with the target view when actionable', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <InsightCard
        finding={makeFinding({ actionable: true, targetView: 'manuscript' })}
        copilot={makeCopilot()}
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'copilot.insightOpenView' }));
    expect(onNavigate).toHaveBeenCalledWith('manuscript');
  });

  it('hides "Open view" when the finding is not actionable', () => {
    render(
      <InsightCard
        finding={makeFinding({ actionable: false })}
        copilot={makeCopilot()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'copilot.insightOpenView' })).toBeNull();
  });

  it('hides "Open view" when no onNavigate handler is provided', () => {
    render(<InsightCard finding={makeFinding({ actionable: true })} copilot={makeCopilot()} />);
    expect(screen.queryByRole('button', { name: 'copilot.insightOpenView' })).toBeNull();
  });
});
