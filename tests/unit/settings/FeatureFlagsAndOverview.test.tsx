/**
 * Tests for FeatureFlagsSection.tsx and SettingsOverviewCard.tsx
 * QNBS-v3: Mocks SettingsViewContext.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleSettingChange = vi.fn();
const mockSetActiveCategory = vi.fn();

const defaultFeatureFlags = {
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: true,
  enableProjectHealthScore: false,
  enableAppHealthPanel: false,
  enableDuckDbAnalytics: false,
  enableObjectsGroups: false,
  enableMindMaps: false,
  enableCharacterInterviews: false,
  enableRtlLayout: false,
  enableLoraAdapters: false,
  enablePluginSystem: false,
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: { privacy: {}, notifications: {} },
    handleSettingChange: mockHandleSettingChange,
    featureFlags: defaultFeatureFlags,
    setActiveCategory: mockSetActiveCategory,
  }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { FeatureFlagsSection } from '../../../components/settings/FeatureFlagsSection';
import { SettingsOverviewCard } from '../../../components/settings/SettingsOverviewCard';

// ---------------------------------------------------------------------------
// FeatureFlagsSection tests
// ---------------------------------------------------------------------------

describe('FeatureFlagsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the section title', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.title')).toBeInTheDocument();
  });

  it('renders description text', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.description')).toBeInTheDocument();
  });

  it('renders feature flag toggles', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(5);
  });

  it('enableCompileWizard is checked (true in fixture)', () => {
    render(<FeatureFlagsSection />);
    const toggle = screen.getByRole('switch', {
      name: 'settings.featureFlags.enableCompileWizard',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('enableDuckDbAnalytics is unchecked', () => {
    render(<FeatureFlagsSection />);
    const toggle = screen.getByRole('switch', {
      name: 'settings.featureFlags.enableDuckDbAnalytics',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('calls handleSettingChange when a flag is toggled', async () => {
    const user = userEvent.setup();
    render(<FeatureFlagsSection />);
    await user.click(screen.getByRole('switch', { name: 'settings.featureFlags.enableMindMaps' }));
    expect(mockHandleSettingChange).toHaveBeenCalledWith('enableMindMaps', true);
  });
});

// ---------------------------------------------------------------------------
// SettingsOverviewCard tests
// ---------------------------------------------------------------------------

describe('SettingsOverviewCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the overview title', () => {
    render(<SettingsOverviewCard />);
    expect(screen.getByText('settings.overview.title')).toBeInTheDocument();
  });

  it('renders navigation buttons', () => {
    render(<SettingsOverviewCard />);
    expect(screen.getByText('settings.overview.openGuide')).toBeInTheDocument();
    expect(screen.getByText('settings.categories.ai')).toBeInTheDocument();
    expect(screen.getByText('settings.categories.backup')).toBeInTheDocument();
    expect(screen.getByText('settings.categories.experimental')).toBeInTheDocument();
  });

  it('calls setActiveCategory("guide") on openGuide click', async () => {
    const user = userEvent.setup();
    render(<SettingsOverviewCard />);
    await user.click(screen.getByText('settings.overview.openGuide'));
    expect(mockSetActiveCategory).toHaveBeenCalledWith('guide');
  });

  it('calls setActiveCategory("ai") on AI button click', async () => {
    const user = userEvent.setup();
    render(<SettingsOverviewCard />);
    await user.click(screen.getByText('settings.categories.ai'));
    expect(mockSetActiveCategory).toHaveBeenCalledWith('ai');
  });

  it('calls setActiveCategory("backup") on backup button click', async () => {
    const user = userEvent.setup();
    render(<SettingsOverviewCard />);
    await user.click(screen.getByText('settings.categories.backup'));
    expect(mockSetActiveCategory).toHaveBeenCalledWith('backup');
  });
});
