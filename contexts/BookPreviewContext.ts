import type { MutableRefObject } from 'react';
import { createContext, useContext } from 'react';
import type { StorySection } from '../types';

export interface BookPreviewContextType {
  t: (key: string, replacements?: Record<string, string>) => string;
  sections: StorySection[];
  sectionRefs: MutableRefObject<Map<string, HTMLElement>>;
  fontSize: number;
  fontFamily: string;
  showWordCount: boolean;
  isFullscreen: boolean;
  isTocOpen: boolean;
  activeId: string | null;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleWordCount: () => void;
  toggleFullscreen: () => void;
  toggleToc: () => void;
  scrollToSection: (id: string) => void;
}

export const BookPreviewContext = createContext<BookPreviewContextType | null>(null);

export const useBookPreviewContext = () => {
  const ctx = useContext(BookPreviewContext);
  if (!ctx)
    throw new Error('useBookPreviewContext must be used within BookPreviewContext.Provider');
  return ctx;
};
