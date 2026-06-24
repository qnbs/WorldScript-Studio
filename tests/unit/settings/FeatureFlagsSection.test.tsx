/**
 * Tests for components/settings/FeatureFlagsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests feature flag toggles list.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange, mockToastSuccess, mockIsTauriRuntime } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
  mockToastSuccess: vi.fn(),
  // QNBS-v3: explicit, controllable Tauri-runtime mock — drives the web (false) vs desktop (true)
  // branch deterministically instead of relying on jsdom's ambient environment.
  mockIsTauriRuntime: vi.fn(() => false),
}));

vi.mock('../../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

const mockFeatureFlags = {
  enableStoryBibleAdvanced: false,
  enableBinderResearch: false,
  enableCompileWizard: false,
  enableProjectHealthScore: false,
  enableAppHealthPanel: false,
  enableDuckDbAnalytics: false,
  enableObjectsGroups: false,
  enableMindMaps: false,
  enableCharacterInterviews: false,
  enableRtlLayout: false,
  enableLoraAdapters: false,
  enablePluginSystem: false,
  enableVoiceSupport: false,
  enableVoiceWasm: false,
  enableProForge: false,
  enableIdbAtRestEncryption: false,
  enableAdaptiveAiEngine: false,
  enableComputeShaders: false,
  enableWorkerBusV2: false,
  enableRustCompute: false,
  enableGlobalCopilot: false,
  enableLocalFirstSync: false,
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
    // QNBS-v3: default to the web runtime; desktop-specific tests opt in explicitly below.
    mockIsTauriRuntime.mockReturnValue(false);
  });

  it('renders the feature flags title', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.title')).toBeInTheDocument();
  });

  it('renders the feature flags description', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getByText('settings.featureFlags.description')).toBeInTheDocument();
  });

  // QNBS-v3: all 22 catalog flags except enableIdbAtRestEncryption (managed in Settings → Privacy)
  // = 21 toggles (the ghost WebNN flag was removed).
  it('renders 21 feature flag toggles', () => {
    render(<FeatureFlagsSection />);
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBe(21);
  });

  it('groups flags under category headings', () => {
    render(<FeatureFlagsSection />);
    // The catalog always has core + ai tiers with visible flags.
    expect(screen.getByText('settings.featureFlags.category.core')).toBeInTheDocument();
    expect(screen.getByText('settings.featureFlags.category.ai')).toBeInTheDocument();
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

  // QNBS-v3: maturity badges are driven by FEATURE_CATALOG — ProForge is 'experimental'.
  it('renders an Experimental badge next to the ProForge toggle', () => {
    render(<FeatureFlagsSection />);
    const label = screen.getByText('settings.featureFlags.enableProForge');
    // label span and the Badge are siblings inside the same flex row.
    const row = label.parentElement as HTMLElement;
    expect(within(row).getByText('common.badge.experimental')).toBeInTheDocument();
  });

  it('renders at least one Beta badge (beta-maturity flags) and Experimental badges', () => {
    render(<FeatureFlagsSection />);
    expect(screen.getAllByText('common.badge.experimental').length).toBeGreaterThan(0);
    expect(screen.getAllByText('common.badge.beta').length).toBeGreaterThan(0);
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

  // QNBS-v3: Voice WASM requires Voice Support — with the prerequisite off AND the flag itself off,
  // its toggle is disabled (can't be turned on).
  it('disables the Voice WASM toggle while Voice Support is off and it is off', () => {
    render(<FeatureFlagsSection />);
    const wasmSwitch = screen.getByRole('switch', {
      name: 'settings.featureFlags.enableVoiceWasm',
    });
    expect(wasmSwitch).toBeDisabled();
  });

  // QNBS-v3: desktop-only flags (Rust Compute) are unavailable on web — with isTauriRuntime() mocked
  // to false, blockedByDesktop is true and the toggle must be disabled while off. Regression guard
  // for the CodeAnt finding that blockedByDesktop was ignored in the disable predicate.
  it('disables the Rust Compute toggle on web (desktop-only) while it is off', () => {
    mockIsTauriRuntime.mockReturnValue(false);
    render(<FeatureFlagsSection />);
    const rustSwitch = screen.getByRole('switch', {
      name: 'settings.featureFlags.enableRustCompute',
    });
    expect(rustSwitch).toBeDisabled();
  });

  // QNBS-v3: on the desktop (Tauri) runtime the platform prerequisite is met, so the same desktop-only
  // flag is interactive even while off — confirms blockedByDesktop, not jsdom ambient, drives the gate.
  it('enables the Rust Compute toggle on the desktop runtime while it is off', () => {
    mockIsTauriRuntime.mockReturnValue(true);
    render(<FeatureFlagsSection />);
    const rustSwitch = screen.getByRole('switch', {
      name: 'settings.featureFlags.enableRustCompute',
    });
    expect(rustSwitch).toBeEnabled();
  });

  // QNBS-v3: but an already-enabled desktop-only flag must stay interactive on web so the user can
  // turn it off — never trap it in a checked+disabled state.
  it('keeps an already-enabled desktop-only toggle interactive on web', () => {
    mockFeatureFlags.enableRustCompute = true;
    try {
      render(<FeatureFlagsSection />);
      const rustSwitch = screen.getByRole('switch', {
        name: 'settings.featureFlags.enableRustCompute',
      });
      expect(rustSwitch).toBeEnabled();
    } finally {
      mockFeatureFlags.enableRustCompute = false;
    }
  });

  // QNBS-v3: but an already-enabled dependent flag must stay interactive so the user can turn it off
  // (no stuck checked+disabled state) — regression guard for CodeAnt finding.
  it('keeps an already-enabled dependent toggle interactive when its prerequisite is off', () => {
    mockFeatureFlags.enableVoiceWasm = true;
    try {
      render(<FeatureFlagsSection />);
      const wasmSwitch = screen.getByRole('switch', {
        name: 'settings.featureFlags.enableVoiceWasm',
      });
      expect(wasmSwitch).toBeEnabled();
    } finally {
      mockFeatureFlags.enableVoiceWasm = false;
    }
  });

  it('resets flags to defaults via handleSettingChange after confirming the dialog', async () => {
    const user = userEvent.setup();
    render(<FeatureFlagsSection />);
    // Only the header trigger exists before the dialog opens.
    const trigger = screen.getByRole('button', {
      name: 'settings.featureFlags.resetToDefaults',
    });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'settings.featureFlags.resetToDefaults' }),
    );
    // QNBS-v3: reset routes through the per-flag handler (so side effects run), not a bulk dispatch.
    // In this fixture every flag is off, so each default-ON flag is re-enabled via handleSettingChange.
    expect(mockHandleSettingChange).toHaveBeenCalledWith('enableMindMaps', true);
    expect(mockHandleSettingChange.mock.calls.length).toBeGreaterThan(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('settings.featureFlags.resetDone');
  });
});
