import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHelpView } from '../../hooks/useHelpView';

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

describe('useHelpView', () => {
  it('initialises with getting-started category and no selected article', () => {
    const { result } = renderHook(() => useHelpView());
    expect(result.current.activeCategory).toBe('getting-started');
    expect(result.current.selectedArticle).toBeNull();
    expect(result.current.searchQuery).toBe('');
  });

  it('handleSelectCategory changes category and clears article + search', () => {
    const { result } = renderHook(() => useHelpView());

    act(() => {
      result.current.handleSelectArticle(result.current.helpContent[0]!.articles[0]!);
    });
    act(() => {
      result.current.setSearchQuery('test');
    });

    act(() => {
      result.current.handleSelectCategory('writing');
    });

    expect(result.current.activeCategory).toBe('writing');
    expect(result.current.selectedArticle).toBeNull();
    expect(result.current.searchQuery).toBe('');
  });

  it('handleSelectArticle sets the selected article', () => {
    const { result } = renderHook(() => useHelpView());
    const firstArticle = result.current.helpContent[0]!.articles[0]!;

    act(() => {
      result.current.handleSelectArticle(firstArticle);
    });

    expect(result.current.selectedArticle).toBe(firstArticle);
  });

  it('handleBackToList clears the selected article', () => {
    const { result } = renderHook(() => useHelpView());
    const firstArticle = result.current.helpContent[0]!.articles[0]!;

    act(() => {
      result.current.handleSelectArticle(firstArticle);
    });
    act(() => {
      result.current.handleBackToList();
    });

    expect(result.current.selectedArticle).toBeNull();
  });

  it('searchResults updates when searchQuery changes', () => {
    const { result } = renderHook(() => useHelpView());

    act(() => {
      result.current.setSearchQuery('export');
    });

    expect(result.current.searchQuery).toBe('export');
    expect(Array.isArray(result.current.searchResults)).toBe(true);
  });

  it('helpContent contains at least one category with articles', () => {
    const { result } = renderHook(() => useHelpView());
    expect(result.current.helpContent.length).toBeGreaterThan(0);
    expect(result.current.helpContent[0]!.articles.length).toBeGreaterThan(0);
  });
});
