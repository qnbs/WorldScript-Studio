import { useCallback, useEffect, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import type { BookPreviewContextType } from '../contexts/BookPreviewContext';
import { selectManuscript } from '../features/project/projectSelectors';
import type { View } from '../types';
import { useTranslation } from './useTranslation';

const FONT_FAMILIES = ['system-ui', 'serif', 'monospace'] as const;
// QNBS-v3: persist reading preferences so the preview reopens the way the reader left it.
const PREFS_KEY = 'worldscript-book-preview-prefs';

interface PreviewPrefs {
  fontSize: number;
  fontFamily: string;
  showWordCount: boolean;
  isTocOpen: boolean;
  isPaginated: boolean;
}

const DEFAULT_PREFS: PreviewPrefs = {
  fontSize: 16,
  fontFamily: 'system-ui',
  showWordCount: false,
  isTocOpen: false,
  isPaginated: false,
};

function loadPrefs(): PreviewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    // QNBS-v3 (CodeAnt): parse to `unknown` and narrow each field, rather than asserting the shape.
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS;
    const p = parsed as Record<string, unknown>;
    const fontSize = p['fontSize'];
    const fontFamily = p['fontFamily'];
    const showWordCount = p['showWordCount'];
    const isTocOpen = p['isTocOpen'];
    const isPaginated = p['isPaginated'];
    return {
      fontSize:
        typeof fontSize === 'number'
          ? Math.max(12, Math.min(24, fontSize))
          : DEFAULT_PREFS.fontSize,
      fontFamily:
        typeof fontFamily === 'string' && (FONT_FAMILIES as readonly string[]).includes(fontFamily)
          ? fontFamily
          : DEFAULT_PREFS.fontFamily,
      showWordCount:
        typeof showWordCount === 'boolean' ? showWordCount : DEFAULT_PREFS.showWordCount,
      isTocOpen: typeof isTocOpen === 'boolean' ? isTocOpen : DEFAULT_PREFS.isTocOpen,
      isPaginated: typeof isPaginated === 'boolean' ? isPaginated : DEFAULT_PREFS.isPaginated,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useBookPreviewView(onNavigate?: (view: View) => void): BookPreviewContextType {
  const { t } = useTranslation();
  const sections = useAppSelector(selectManuscript);
  const setExportInitialFormat = useTransientUiStore((s) => s.setExportInitialFormat);

  const [prefs] = useState<PreviewPrefs>(() => loadPrefs());
  const [fontSize, setFontSizeState] = useState(prefs.fontSize);
  const [fontFamily, setFontFamilyState] = useState<string>(prefs.fontFamily);
  const [showWordCount, setShowWordCount] = useState(prefs.showWordCount);
  const [isTocOpen, setIsTocOpen] = useState(prefs.isTocOpen);
  const [isPaginated, setIsPaginated] = useState(prefs.isPaginated);
  // QNBS-v3: fullscreen is ephemeral — never persisted (a reload should not trap the user in it).
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Persist preferences whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ fontSize, fontFamily, showWordCount, isTocOpen, isPaginated }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [fontSize, fontFamily, showWordCount, isTocOpen, isPaginated]);

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
  const togglePaginated = useCallback(() => setIsPaginated((v) => !v), []);

  // QNBS-v3: preselect EPUB in the Export view, then navigate — the hand-off the help text promised.
  // QNBS-v3 (CodeAnt): only set the preselection flag when we can actually navigate, so a missing
  // nav callback can't leave a stale 'epub' flag that mis-fires the next time Export mounts.
  const onExport = useCallback(() => {
    if (!onNavigate) return;
    setExportInitialFormat('epub');
    onNavigate('export');
  }, [setExportInitialFormat, onNavigate]);

  return {
    t,
    sections,
    fontSize,
    fontFamily,
    showWordCount,
    isFullscreen,
    isTocOpen,
    isPaginated,
    setFontSize,
    setFontFamily,
    toggleWordCount,
    toggleFullscreen,
    toggleToc,
    togglePaginated,
    onExport,
  };
}
