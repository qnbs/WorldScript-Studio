/**
 * Tests for components/settings/DesktopSection.tsx
 * QNBS-v3 (P1.3): the minimize-to-tray control is the design-system ToggleSwitch (role=switch +
 * aria-describedby hint), Tauri-gated. Verifies the web no-op, accessible switch, state reflection,
 * and dispatch on toggle.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootState } from '../../../app/store';

// ---------------------------------------------------------------------------
// Mocks (component uses real Redux hooks + useTranslation + the Tauri gate)
// ---------------------------------------------------------------------------

const { mockDispatch, stateRef, mockIsTauri } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  stateRef: { minimizeToTray: false },
  mockIsTauri: vi.fn(() => true),
}));

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  // QNBS-v3: type the selector against RootState (not `any`) and feed it a minimal slice cast through
  // `unknown` — keeps the test honest without a lint suppression (the ratchet gate stays at baseline).
  useAppSelector: (selector: (s: RootState) => unknown) =>
    selector({
      settings: { desktop: { minimizeToTray: stateRef.minimizeToTray } },
    } as unknown as RootState),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauri(),
}));

import { DesktopSection } from '../../../components/settings/DesktopSection';
import { settingsActions } from '../../../features/settings/settingsSlice';

describe('DesktopSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateRef.minimizeToTray = false;
    mockIsTauri.mockReturnValue(true);
  });

  it('renders nothing on the web (non-Tauri runtime)', () => {
    mockIsTauri.mockReturnValue(false);
    const { container } = render(<DesktopSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the minimize-to-tray switch with an accessible name + described-by hint', () => {
    render(<DesktopSection />);
    const sw = screen.getByRole('switch', { name: 'desktop.settings.minimizeToTray' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAttribute('aria-describedby');
  });

  it('reflects the enabled state via aria-checked', () => {
    stateRef.minimizeToTray = true;
    render(<DesktopSection />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('dispatches setDesktopSettings({ minimizeToTray: true }) when toggled on', async () => {
    const user = userEvent.setup();
    render(<DesktopSection />);
    await user.click(screen.getByRole('switch'));
    expect(mockDispatch).toHaveBeenCalledWith(
      settingsActions.setDesktopSettings({ minimizeToTray: true }),
    );
  });
});
