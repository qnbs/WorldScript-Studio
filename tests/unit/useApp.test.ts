import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../../hooks/useApp';

beforeEach(() => {
  localStorage.clear();
});

describe('useApp', () => {
  it('defaults to dashboard view when no stored view exists', () => {
    const { result } = renderHook(() => useApp({ isNewUser: false }));
    expect(result.current.currentView).toBe('dashboard');
  });

  it('restores the last view from localStorage', () => {
    localStorage.setItem('storycraft-last-view', 'writer');
    const { result } = renderHook(() => useApp({ isNewUser: false }));
    expect(result.current.currentView).toBe('writer');
  });

  it('handleNavigate updates currentView and persists to localStorage', () => {
    const { result } = renderHook(() => useApp({ isNewUser: false }));

    act(() => {
      result.current.handleNavigate('settings');
    });

    expect(result.current.currentView).toBe('settings');
    expect(localStorage.getItem('storycraft-last-view')).toBe('settings');
  });

  it('handlePortalExit sets isPortalActive to false', () => {
    const { result } = renderHook(() => useApp({ isNewUser: true }));

    act(() => {
      result.current.handlePortalExit();
    });

    expect(result.current.isPortalActive).toBe(false);
  });

  it('handlePortalExit can navigate to a specific view', () => {
    const { result } = renderHook(() => useApp({ isNewUser: true }));

    act(() => {
      result.current.handlePortalExit('manuscript');
    });

    expect(result.current.currentView).toBe('manuscript');
    expect(result.current.isPortalActive).toBe(false);
  });

  it('activates portal for new users', () => {
    const { result } = renderHook(() => useApp({ isNewUser: true }));
    expect(result.current.isPortalActive).toBe(true);
  });

  it('does not activate portal for returning users', () => {
    const { result } = renderHook(() => useApp({ isNewUser: false }));
    expect(result.current.isPortalActive).toBe(false);
  });

  it('setIsSidebarOpen toggles sidebar state', () => {
    const { result } = renderHook(() => useApp({ isNewUser: false }));

    act(() => {
      result.current.setIsSidebarOpen(true);
    });

    expect(result.current.isSidebarOpen).toBe(true);
  });

  it('isInitialLoad starts true and becomes false after mount', () => {
    const { result } = renderHook(() => useApp({ isNewUser: false }));
    // After the useEffect fires isInitialLoad should be false
    expect(result.current.isInitialLoad).toBe(false);
  });
});
