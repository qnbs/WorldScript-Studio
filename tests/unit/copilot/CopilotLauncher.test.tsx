/**
 * Tests for components/copilot/CopilotLauncher.tsx — the floating Copilot FAB.
 * QNBS-v3: shows the FAB when closed (clicking opens), swaps to CopilotPanel when open, and announces
 * open/close transitions for screen-reader users.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOpen, mockAnnounce } = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockAnnounce: vi.fn(),
}));

let mockIsOpen = false;

vi.mock('../../../hooks/useGlobalCopilot', () => ({
  useGlobalCopilot: () => ({
    t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k),
    isOpen: mockIsOpen,
    open: mockOpen,
  }),
}));

vi.mock('../../../contexts/LiveRegionContext', () => ({ useAnnounce: () => mockAnnounce }));
vi.mock('../../../services/viewNavigationLabels', () => ({
  viewNavigationLabelKey: (v: string) => `nav.${v}`,
}));
vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../components/copilot/CopilotPanel', () => ({
  CopilotPanel: ({ contextLabel }: { contextLabel: string }) => (
    <div data-testid="copilot-panel">{contextLabel}</div>
  ),
}));

import { CopilotLauncher } from '../../../components/copilot/CopilotLauncher';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsOpen = false;
});

describe('CopilotLauncher', () => {
  it('renders the FAB (and no panel) when the Copilot is closed', () => {
    render(<CopilotLauncher currentView="manuscript" />);
    expect(screen.getByRole('button', { name: 'copilot.launcherLabel' })).toBeInTheDocument();
    expect(screen.queryByTestId('copilot-panel')).toBeNull();
  });

  it('opens the Copilot when the FAB is clicked', async () => {
    const user = userEvent.setup();
    render(<CopilotLauncher currentView="manuscript" />);
    await user.click(screen.getByRole('button', { name: 'copilot.launcherLabel' }));
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('renders the CopilotPanel (and no FAB) when open', () => {
    mockIsOpen = true;
    render(<CopilotLauncher currentView="manuscript" />);
    expect(screen.getByTestId('copilot-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'copilot.launcherLabel' })).toBeNull();
  });

  it('announces a state change when the panel opens', () => {
    const { rerender } = render(<CopilotLauncher currentView="manuscript" />);
    expect(mockAnnounce).not.toHaveBeenCalled();
    mockIsOpen = true;
    rerender(<CopilotLauncher currentView="manuscript" />);
    expect(mockAnnounce).toHaveBeenCalledWith('copilot.announceOpened', 'polite');
  });
});
