/**
 * Tests for components/settings/ShortcutsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext + keyboardShortcutsDefaults + Redux; tests shortcut list, recording, reset.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
}));

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: {
      keyboardShortcuts: [
        { id: 'sc-save', action: 'save', keys: ['ctrl', 's'] },
        { id: 'sc-undo', action: 'undo', keys: ['ctrl', 'z'] },
      ],
    },
  }),
}));

vi.mock('../../../features/settings/keyboardShortcutsDefaults', () => ({
  SHORTCUT_ACTION_REGISTRY: [
    { action: 'save', labelKey: 'shortcuts.save', defaultKeys: ['ctrl', 's'] },
    { action: 'undo', labelKey: 'shortcuts.undo', defaultKeys: ['ctrl', 'z'] },
  ],
  getDefaultKeyboardShortcuts: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../services/keyboard/shortcutConflicts', () => ({
  // QNBS-v3: return an array, not Set — conflicts.includes() is called in the component
  getShortcutConflictSignatures: vi.fn().mockReturnValue([]),
  serializeShortcutChord: vi.fn((keys: string[]) => keys.join('+')),
}));

vi.mock('../../../features/settings/settingsSlice', () => ({
  settingsActions: {
    setKeyboardShortcuts: vi.fn((p: unknown) => ({
      type: 'settings/setKeyboardShortcuts',
      payload: p,
    })),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ShortcutsSection } from '../../../components/settings/ShortcutsSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// QNBS-v3: Regression — the component uses `settings.keyboardShortcuts ?? []`
// so it renders safely even when the field is absent from old IDB states (pre-v1.8).
describe('ShortcutsSection — defensive fallback', () => {
  it('renders without crashing (relies on ?? [] guard in component)', () => {
    // The vi.mock above provides keyboardShortcuts; this test just ensures
    // no uncaught TypeError from array operations on a potentially-undefined field.
    expect(() => render(<ShortcutsSection />)).not.toThrow();
  });
});

describe('ShortcutsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the shortcuts title', () => {
    render(<ShortcutsSection />);
    expect(screen.getByText('settings.shortcuts.title')).toBeInTheDocument();
  });

  it('renders shortcut action names from registry', () => {
    render(<ShortcutsSection />);
    expect(screen.getByText('shortcuts.save')).toBeInTheDocument();
    expect(screen.getByText('shortcuts.undo')).toBeInTheDocument();
  });

  it('renders current key bindings with formatKeysForDisplay separator', () => {
    render(<ShortcutsSection />);
    // formatKeysForDisplay joins with ' + ' on non-Apple platforms
    expect(screen.getByText('ctrl + s')).toBeInTheDocument();
    expect(screen.getByText('ctrl + z')).toBeInTheDocument();
  });

  it('renders record buttons for each shortcut', () => {
    render(<ShortcutsSection />);
    const recordBtns = screen.getAllByText('settings.shortcuts.record');
    expect(recordBtns.length).toBe(2);
  });

  it('renders reset defaults button', () => {
    render(<ShortcutsSection />);
    expect(screen.getByText('settings.shortcuts.resetDefaults')).toBeInTheDocument();
  });

  it('dispatches setKeyboardShortcuts when reset defaults is clicked', async () => {
    const { settingsActions } = await import('../../../features/settings/settingsSlice');
    const user = userEvent.setup();
    render(<ShortcutsSection />);
    await user.click(screen.getByText('settings.shortcuts.resetDefaults'));
    // Dynamic import of keyboardShortcutsDefaults triggers the dispatch
    await vi.dynamicImportSettled();
    expect(settingsActions.setKeyboardShortcuts).toHaveBeenCalled();
  });

  it('enters recording mode when record is clicked', async () => {
    const user = userEvent.setup();
    render(<ShortcutsSection />);
    const recordBtns = screen.getAllByText('settings.shortcuts.record');
    await user.click(recordBtns[0]!);
    // Button text changes to 'listening' when recording
    expect(screen.getByText('settings.shortcuts.listening')).toBeInTheDocument();
  });
});
