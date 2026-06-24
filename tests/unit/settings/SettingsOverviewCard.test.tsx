/**
 * Tests for components/settings/SettingsOverviewCard.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests quick-link buttons + navigation.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetActiveCategory = vi.fn();

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    setActiveCategory: mockSetActiveCategory,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { SettingsOverviewCard } from '../../../components/settings/SettingsOverviewCard';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsOverviewCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the overview title', () => {
    render(<SettingsOverviewCard />);
    expect(screen.getByText('settings.overview.title')).toBeInTheDocument();
  });

  // QNBS-v3: the dead Backup section was removed, so its overview quick-link is gone (3 remain).
  it('renders three quick-link buttons', () => {
    render(<SettingsOverviewCard />);
    expect(screen.getAllByRole('button').length).toBe(3);
  });

  it('renders guide button', () => {
    render(<SettingsOverviewCard />);
    expect(screen.getByText('settings.overview.openGuide')).toBeInTheDocument();
  });

  it('renders AI button', () => {
    render(<SettingsOverviewCard />);
    expect(screen.getByText('settings.categories.ai')).toBeInTheDocument();
  });

  it('renders experimental button', () => {
    render(<SettingsOverviewCard />);
    expect(screen.getByText('settings.categories.experimental')).toBeInTheDocument();
  });

  it('calls setActiveCategory("guide") when guide button clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsOverviewCard />);
    await user.click(screen.getByText('settings.overview.openGuide'));
    expect(mockSetActiveCategory).toHaveBeenCalledWith('guide');
  });

  it('calls setActiveCategory("ai") when AI button clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsOverviewCard />);
    await user.click(screen.getByText('settings.categories.ai'));
    expect(mockSetActiveCategory).toHaveBeenCalledWith('ai');
  });

  it('calls setActiveCategory("experimental") when experimental button clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsOverviewCard />);
    await user.click(screen.getByText('settings.categories.experimental'));
    expect(mockSetActiveCategory).toHaveBeenCalledWith('experimental');
  });
});
