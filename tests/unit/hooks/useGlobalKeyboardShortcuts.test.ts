import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalKeyboardShortcuts } from '../../../hooks/useGlobalKeyboardShortcuts';
import type { ShortcutRuntimeApi } from '../../../services/keyboard/shortcutActions';
import type { KeyboardShortcut } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMatchingShortcutAction = vi.fn();
const mockPerformShortcutAction = vi.fn();

vi.mock('../../../services/keyboard/shortcutActions', () => ({
  findMatchingShortcutAction: (e: KeyboardEvent, s: { keys: string[]; action: string }[]) =>
    mockFindMatchingShortcutAction(e, s),
  performShortcutAction: (a: string, api: ShortcutRuntimeApi) => mockPerformShortcutAction(a, api),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dummyShortcuts: KeyboardShortcut[] = [
  { id: 'shortcut-1', action: 'toggleDarkMode', keys: ['Ctrl', 'D'] },
];

// Cast partial — actual values passed to mocked performShortcutAction, not real implementation
const dummyApi = {
  dispatch: vi.fn(),
  navigate: vi.fn(),
  t: (k: string) => k,
  setCommandPaletteOpen: vi.fn(),
} as unknown as ShortcutRuntimeApi;

function fireKeyDown(target: EventTarget, overrides: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...overrides });
  Object.defineProperty(event, 'target', { value: target, configurable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMatchingShortcutAction.mockReturnValue(null);
  mockPerformShortcutAction.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// disabled flag
// ---------------------------------------------------------------------------
describe('disabled param', () => {
  it('does not register a listener when disabled is true', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() =>
      useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi, disabled: true }),
    );
    expect(addSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function), true);
    addSpy.mockRestore();
  });

  it('registers a listener when disabled is false', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() =>
      useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi, disabled: false }),
    );
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    addSpy.mockRestore();
  });

  it('registers a listener when disabled is undefined', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    addSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// cleanup on unmount
// ---------------------------------------------------------------------------
describe('cleanup', () => {
  it('removes the keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() =>
      useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }),
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    removeSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// no matching action
// ---------------------------------------------------------------------------
describe('no matching shortcut', () => {
  it('does not call performShortcutAction when no action matches', () => {
    mockFindMatchingShortcutAction.mockReturnValue(null);
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));

    act(() => {
      fireKeyDown(document.body, { key: 'X' });
    });

    expect(mockPerformShortcutAction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// matching action in normal (non-editable) context
// ---------------------------------------------------------------------------
describe('matching action in non-editable target', () => {
  it('calls performShortcutAction for a matched shortcut', () => {
    mockFindMatchingShortcutAction.mockReturnValue('toggleDarkMode');
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));

    act(() => {
      fireKeyDown(document.body);
    });

    expect(mockPerformShortcutAction).toHaveBeenCalledWith('toggleDarkMode', dummyApi);
  });

  it('calls preventDefault when a shortcut matches', () => {
    mockFindMatchingShortcutAction.mockReturnValue('toggleDarkMode');
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));

    const preventDefaultSpy = vi.fn();
    const event = new KeyboardEvent('keydown', { bubbles: true });
    Object.defineProperty(event, 'target', { value: document.body, configurable: true });
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefaultSpy,
      configurable: true,
    });
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// editable target suppression
// ---------------------------------------------------------------------------
describe('editable target suppression', () => {
  it('does not call performShortcutAction when target is an INPUT', () => {
    mockFindMatchingShortcutAction.mockReturnValue('toggleDarkMode');
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));

    const input = document.createElement('input');
    act(() => {
      fireKeyDown(input);
    });

    expect(mockPerformShortcutAction).not.toHaveBeenCalled();
  });

  it('does not call performShortcutAction when target is a TEXTAREA', () => {
    mockFindMatchingShortcutAction.mockReturnValue('toggleDarkMode');
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));

    const textarea = document.createElement('textarea');
    act(() => {
      fireKeyDown(textarea);
    });

    expect(mockPerformShortcutAction).not.toHaveBeenCalled();
  });

  it('calls performShortcutAction for openCommandPalette even in an INPUT', () => {
    mockFindMatchingShortcutAction.mockReturnValue('openCommandPalette');
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));

    const input = document.createElement('input');
    act(() => {
      fireKeyDown(input);
    });

    expect(mockPerformShortcutAction).toHaveBeenCalledWith('openCommandPalette', dummyApi);
  });

  it('calls performShortcutAction for openCommandPalette in a TEXTAREA', () => {
    mockFindMatchingShortcutAction.mockReturnValue('openCommandPalette');
    renderHook(() => useGlobalKeyboardShortcuts({ shortcuts: dummyShortcuts, api: dummyApi }));

    const textarea = document.createElement('textarea');
    act(() => {
      fireKeyDown(textarea);
    });

    expect(mockPerformShortcutAction).toHaveBeenCalledWith('openCommandPalette', dummyApi);
  });
});
