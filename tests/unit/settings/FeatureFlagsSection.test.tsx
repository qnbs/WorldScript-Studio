/**
 * Tests for components/settings/FeatureFlagsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests feature flag toggles list.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
}));

const mockFeatureFlags = {
  enableCodexAutoTracking: false,
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  enableCrossProjectSearch: false,
  enableAppHealthPanel: false,
  enablePlotBoardV2: false,
  enableDuckDbAnalytics: false,
  enableObjectsGroups: false,
  enableMindMaps: false,
  enableCharacterInterviews: false,
  enableRtlLayout: false,
  enableCloudSync: false,
  enableLoraAdapters: false,
  enablePluginSystem: false,
  enableVoiceSupport: false,
  enableVoiceWasm: false,
  enableProForge: false,
  enableIdbAtRestEncryption: false,
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    featureFlags: mockFeatureFlags,
    handleSettingChange: mockHandleSettingChange,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { FeatureFlagsSection } from '../../../components/settings/FeatureFlagsSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureFlagsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the feature flags title', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.title')).toBeInTheDocument();
  });

  it('renders the feature flags description', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.description')).toBeInTheDocument();
  });

  // QNBS-v3: 18 original + 3 Edge-AI flags + 2 WorkerBus v2 Phase 2 flags = 23
  it('renders 23 feature flag toggles (enablePlotBoardV2 deprecated, enableIdbAtRestEncryption moved to Privacy)', () => {
    render(<FeatureFlagsSection />);
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBe(23);
  });

  it('does not render the IDB at-rest encryption toggle (managed in Privacy settings)', () => {
    render(<FeatureFlagsSection />);
    expect(
      screen.queryByText('settings.featureFlags.enableIdbAtRestEncryption'),
    ).not.toBeInTheDocument();
  });

  it('renders DuckDB analytics toggle', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableDuckDbAnalytics')).toBeInTheDocument();
  });

  it('renders ProForge toggle', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableProForge')).toBeInTheDocument();
  });

  it('renders voice support and voice WASM toggles', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableVoiceSupport')).toBeInTheDocument();
    expect(screen.getByText('settings.featureFlags.enableVoiceWasm')).toBeInTheDocument();
  });

  it('renders character interviews toggle', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableCharacterInterviews')).toBeInTheDocument();
  });

  it('renders WorkerBus v2 and Rust Compute toggles (Phase 2)', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.enableWorkerBusV2')).toBeInTheDocument();
    expect(screen.getByText('settings.featureFlags.enableRustCompute')).toBeInTheDocument();
  });

  it('calls handleSettingChange when a flag is toggled', async () => {
    const user = userEvent.setup();
    render(<FeatureFlagsSection />);
    const duckDbSwitch = screen.getByRole('switch', {
      name: 'settings.featureFlags.enableDuckDbAnalytics',
    });
    await user.click(duckDbSwitch);
    expect(mockHandleSettingChange).toHaveBeenCalledWith('enableDuckDbAnalytics', true);
  });
});
