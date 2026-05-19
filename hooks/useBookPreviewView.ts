import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import type { BookPreviewContextType } from '../contexts/BookPreviewContext';
import { selectManuscript } from '../features/project/projectSelectors';
import { useTranslation } from './useTranslation';

const FONT_FAMILIES = ['system-ui', 'serif', 'monospace'] as const;

export function useBookPreviewView(): BookPreviewContextType {
  const { t } = useTranslation();
  const sections = useAppSelector(selectManuscript);

  const [fontSize, setFontSizeState] = useState(16);
  const [fontFamily, setFontFamilyState] = useState<string>('system-ui');
  const [showWordCount, setShowWordCount] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Track scroll position to highlight active TOC entry
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { threshold: 0.3 },
    );
    for (const el of sectionRefs.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  // ESC key closes fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const setFontSize = useCallback((size: number) => {
    setFontSizeState(Math.max(12, Math.min(24, size)));
  }, []);

  const setFontFamily = useCallback((family: string) => {
    if ((FONT_FAMILIES as readonly string[]).includes(family)) {
      setFontFamilyState(family);
    }
  }, []);

  const toggleWordCount = useCallback(() => setShowWordCount((v) => !v), []);
  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), []);
  const toggleToc = useCallback(() => setIsTocOpen((v) => !v), []);

  const scrollToSection = useCallback((id: string) => {
    const el = sectionRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  }, []);

  return {
    t,
    sections,
    sectionRefs,
    fontSize,
    fontFamily,
    showWordCount,
    isFullscreen,
    isTocOpen,
    activeId,
    setFontSize,
    setFontFamily,
    toggleWordCount,
    toggleFullscreen,
    toggleToc,
    scrollToSection,
  };
}

// Suppress unused import warning from MutableRefObject usage
export type { MutableRefObject };
