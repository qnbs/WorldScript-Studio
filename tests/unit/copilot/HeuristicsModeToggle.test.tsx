/**
 * Tests for components/copilot/HeuristicsModeToggle.tsx — ARIA switch for "Heuristics Only" mode.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HeuristicsModeToggle } from '../../../components/copilot/HeuristicsModeToggle';

vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));

const t = ((k: string) => k) as never;

describe('HeuristicsModeToggle', () => {
  it('renders an ARIA switch reflecting the heuristicsOnly state', () => {
    const { rerender } = render(
      <HeuristicsModeToggle heuristicsOnly={false} onToggle={vi.fn()} t={t} />,
    );
    const sw = screen.getByRole('switch', { name: 'copilot.heuristicsOnlyLabel' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    rerender(<HeuristicsModeToggle heuristicsOnly={true} onToggle={vi.fn()} t={t} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<HeuristicsModeToggle heuristicsOnly={false} onToggle={onToggle} t={t} />);
    await user.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders the heuristics-only label text', () => {
    render(<HeuristicsModeToggle heuristicsOnly={false} onToggle={vi.fn()} t={t} />);
    expect(screen.getByText('copilot.heuristicsOnly')).toBeInTheDocument();
  });
});
