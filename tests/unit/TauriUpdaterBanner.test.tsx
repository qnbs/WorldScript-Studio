/**
 * Tests for components/settings/TauriUpdaterBanner.tsx
 * QNBS-v3: Covers non-desktop hide, update states, and button actions.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCheckForUpdate = vi.fn().mockResolvedValue(undefined);
const mockInstallUpdate = vi.fn().mockResolvedValue(undefined);

let mockUpdaterState = {
  isDesktop: false,
  update: null as { version: string; currentVersion: string; available: boolean } | null,
  checking: false,
  installing: false,
  error: null as string | null,
  checkForUpdate: mockCheckForUpdate,
  installUpdate: mockInstallUpdate,
};

vi.mock('../../hooks/useTauriUpdater', () => ({
  useTauriUpdater: () => mockUpdaterState,
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, string>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { TauriUpdaterBanner } from '../../components/settings/TauriUpdaterBanner';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TauriUpdaterBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdaterState = {
      isDesktop: false,
      update: null,
      checking: false,
      installing: false,
      error: null,
      checkForUpdate: mockCheckForUpdate,
      installUpdate: mockInstallUpdate,
    };
  });

  it('renders nothing when not on desktop', () => {
    const { container } = render(<TauriUpdaterBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner when on desktop', () => {
    mockUpdaterState = { ...mockUpdaterState, isDesktop: true };
    render(<TauriUpdaterBanner />);
    expect(screen.getByText('settings.tauri.updaterTitle')).toBeInTheDocument();
  });

  it('shows spinner when checking', () => {
    mockUpdaterState = { ...mockUpdaterState, isDesktop: true, checking: true };
    render(<TauriUpdaterBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error message when error is set', () => {
    mockUpdaterState = { ...mockUpdaterState, isDesktop: true, error: 'Network timeout' };
    render(<TauriUpdaterBanner />);
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  it('shows up-to-date message when update available=false', () => {
    mockUpdaterState = {
      ...mockUpdaterState,
      isDesktop: true,
      update: { version: '1.0.0', currentVersion: '1.0.0', available: false },
    };
    render(<TauriUpdaterBanner />);
    expect(screen.getByText('settings.tauri.upToDate')).toBeInTheDocument();
  });

  it('shows update available info when update.available=true', () => {
    mockUpdaterState = {
      ...mockUpdaterState,
      isDesktop: true,
      update: { version: '2.0.0', currentVersion: '1.0.0', available: true },
    };
    render(<TauriUpdaterBanner />);
    expect(screen.getByText(/updateAvailable/)).toBeInTheDocument();
  });

  it('shows install button when update is available', () => {
    mockUpdaterState = {
      ...mockUpdaterState,
      isDesktop: true,
      update: { version: '2.0.0', currentVersion: '1.0.0', available: true },
    };
    render(<TauriUpdaterBanner />);
    expect(screen.getByText('settings.tauri.install')).toBeInTheDocument();
  });

  it('calls checkForUpdate when check button is clicked', async () => {
    mockUpdaterState = { ...mockUpdaterState, isDesktop: true };
    const user = userEvent.setup();
    render(<TauriUpdaterBanner />);
    await user.click(screen.getByText('settings.tauri.checkAgain'));
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls installUpdate when install button is clicked', async () => {
    mockUpdaterState = {
      ...mockUpdaterState,
      isDesktop: true,
      update: { version: '2.0.0', currentVersion: '1.0.0', available: true },
    };
    const user = userEvent.setup();
    render(<TauriUpdaterBanner />);
    await user.click(screen.getByText('settings.tauri.install'));
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1);
  });
});
