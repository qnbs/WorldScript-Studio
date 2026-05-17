import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from '../../../hooks/useFocusTrap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(...tagNames: string[]): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute('tabindex', '-1');
  for (const tag of tagNames) {
    const el = document.createElement(tag) as HTMLElement;
    div.appendChild(el);
  }
  document.body.appendChild(div);
  return div;
}

function cleanup(container: HTMLElement) {
  document.body.removeChild(container);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFocusTrap', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = makeContainer('button', 'button', 'input');
  });

  afterEach(() => {
    cleanup(container);
    vi.restoreAllMocks();
  });

  it('does nothing when isActive is false', () => {
    const ref = { current: container };
    const focusSpy = vi.spyOn(container, 'focus');
    renderHook(() => useFocusTrap(ref, { isActive: false }));
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('focuses the first focusable element when activated', () => {
    const ref = { current: container };
    const firstButton = container.querySelector('button') as HTMLButtonElement;
    const focusSpy = vi.spyOn(firstButton, 'focus');
    renderHook(() => useFocusTrap(ref, { isActive: true }));
    expect(focusSpy).toHaveBeenCalled();
  });

  it('focuses the container itself when no focusable children exist', () => {
    const emptyContainer = makeContainer();
    const ref = { current: emptyContainer };
    const focusSpy = vi.spyOn(emptyContainer, 'focus');
    renderHook(() => useFocusTrap(ref, { isActive: true }));
    expect(focusSpy).toHaveBeenCalled();
    cleanup(emptyContainer);
  });

  it('restores focus to previously focused element on deactivation by default', () => {
    const externalButton = document.createElement('button');
    document.body.appendChild(externalButton);
    externalButton.focus();
    const restoreSpy = vi.spyOn(externalButton, 'focus');

    const ref = { current: container };
    const { unmount } = renderHook(() => useFocusTrap(ref, { isActive: true }));
    unmount();
    expect(restoreSpy).toHaveBeenCalled();
    document.body.removeChild(externalButton);
  });

  it('does not restore focus when restoreFocus is false', () => {
    const externalButton = document.createElement('button');
    document.body.appendChild(externalButton);
    externalButton.focus();
    const restoreSpy = vi.spyOn(externalButton, 'focus');

    const ref = { current: container };
    const { unmount } = renderHook(() =>
      useFocusTrap(ref, { isActive: true, restoreFocus: false }),
    );
    unmount();
    expect(restoreSpy).not.toHaveBeenCalled();
    document.body.removeChild(externalButton);
  });

  it('wraps Tab from last element to first', () => {
    const ref = { current: container };
    const [first, , last] = Array.from(container.querySelectorAll<HTMLElement>('button, input'));
    renderHook(() => useFocusTrap(ref, { isActive: true }));

    // Simulate focus on last element then Tab
    Object.defineProperty(document, 'activeElement', {
      get: () => last,
      configurable: true,
    });
    const focusSpy = vi.spyOn(first as HTMLElement, 'focus');
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault');
    container.dispatchEvent(tabEvent);
    expect(preventSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('wraps Shift+Tab from first element to last', () => {
    const ref = { current: container };
    const [first, , last] = Array.from(container.querySelectorAll<HTMLElement>('button, input'));
    renderHook(() => useFocusTrap(ref, { isActive: true }));

    Object.defineProperty(document, 'activeElement', {
      get: () => first,
      configurable: true,
    });
    const focusSpy = vi.spyOn(last as HTMLElement, 'focus');
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
    });
    const preventSpy = vi.spyOn(shiftTabEvent, 'preventDefault');
    container.dispatchEvent(shiftTabEvent);
    expect(preventSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('ignores non-Tab keydown events', () => {
    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, { isActive: true }));
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const preventSpy = vi.spyOn(escEvent, 'preventDefault');
    container.dispatchEvent(escEvent);
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('prevents default Tab when no focusable children', () => {
    const emptyContainer = makeContainer();
    const ref = { current: emptyContainer };
    renderHook(() => useFocusTrap(ref, { isActive: true }));
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const preventSpy = vi.spyOn(tabEvent, 'preventDefault');
    emptyContainer.dispatchEvent(tabEvent);
    expect(preventSpy).toHaveBeenCalled();
    cleanup(emptyContainer);
  });
});
