import { createContext, useContext } from 'react';
import type { StorySection } from '../types';

export interface BookPreviewContextType {
  t: (key: string, replacements?: Record<string, string>) => string;
  sections: StorySection[];
  fontSize: number;
  fontFamily: string;
  showWordCount: boolean;
  isFullscreen: boolean;
  isTocOpen: boolean;
  // QNBS-v3: paged reading style (page-like sheets) vs continuous scroll — a reading preference,
  // persisted alongside the others. Virtualization stays on in both modes.
  isPaginated: boolean;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleWordCount: () => void;
  toggleFullscreen: () => void;
  toggleToc: () => void;
  togglePaginated: () => void;
  // QNBS-v3: hand off to the Export view preset to EPUB mode (the docs promised this; it never existed).
  onExport: () => void;
}

export const BookPreviewContext = createContext<BookPreviewContextType | null>(null);

export const useBookPreviewContext = () => {
  const ctx = useContext(BookPreviewContext);
  if (!ctx)
    throw new Error('useBookPreviewContext must be used within BookPreviewContext.Provider');
  return ctx;
};
