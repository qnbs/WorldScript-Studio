import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTransientUiStore } from '../../app/transientUiStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTransientUiStore', () => {
  it('has default values', () => {
    const { result } = renderHook(() => useTransientUiStore());
    expect(result.current.isCommandPaletteOpen).toBe(false);
    expect(result.current.inspectorPanelWidth).toBe(360);
    expect(result.current.compileWizardOpen).toBe(false);
    expect(result.current.manuscriptResearchSplitOpen).toBe(false);
    expect(result.current.manuscriptPinnedBinderNodeId).toBeNull();
    expect(result.current.isCrossProjectSearchOpen).toBe(false);
  });

  it('setCommandPaletteOpen updates isCommandPaletteOpen', () => {
    const { result } = renderHook(() => useTransientUiStore());
    act(() => {
      result.current.setCommandPaletteOpen(true);
    });
    expect(result.current.isCommandPaletteOpen).toBe(true);
    act(() => {
      result.current.setCommandPaletteOpen(false);
    });
    expect(result.current.isCommandPaletteOpen).toBe(false);
  });

  it('setInspectorPanelWidth updates inspectorPanelWidth', () => {
    const { result } = renderHook(() => useTransientUiStore());
    act(() => {
      result.current.setInspectorPanelWidth(500);
    });
    expect(result.current.inspectorPanelWidth).toBe(500);
  });

  it('setCompileWizardOpen updates compileWizardOpen', () => {
    const { result } = renderHook(() => useTransientUiStore());
    act(() => {
      result.current.setCompileWizardOpen(true);
    });
    expect(result.current.compileWizardOpen).toBe(true);
  });

  it('setManuscriptResearchSplitOpen updates manuscriptResearchSplitOpen', () => {
    const { result } = renderHook(() => useTransientUiStore());
    act(() => {
      result.current.setManuscriptResearchSplitOpen(true);
    });
    expect(result.current.manuscriptResearchSplitOpen).toBe(true);
  });

  it('setManuscriptPinnedBinderNodeId updates the pinned node', () => {
    const { result } = renderHook(() => useTransientUiStore());
    act(() => {
      result.current.setManuscriptPinnedBinderNodeId('node-123');
    });
    expect(result.current.manuscriptPinnedBinderNodeId).toBe('node-123');
    act(() => {
      result.current.setManuscriptPinnedBinderNodeId(null);
    });
    expect(result.current.manuscriptPinnedBinderNodeId).toBeNull();
  });

  it('setCrossProjectSearchOpen updates isCrossProjectSearchOpen', () => {
    const { result } = renderHook(() => useTransientUiStore());
    act(() => {
      result.current.setCrossProjectSearchOpen(true);
    });
    expect(result.current.isCrossProjectSearchOpen).toBe(true);
  });
});
