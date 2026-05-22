import type React from 'react';
import { ActionCreators as UndoAction } from 'redux-undo';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { ICONS } from '../constants';
import { selectCanRedo, selectCanUndo } from '../features/project/projectSelectors';
import { useTranslation } from '../hooks/useTranslation';
import { viewNavigationLabelKey } from '../services/viewNavigationLabels';
import type { View } from '../types';
import { SaveStatusIndicator } from './ui/SaveStatusIndicator';
import { SectionIcon } from './ui/SectionIcon';
import { Tooltip } from './ui/Tooltip';

interface HeaderProps {
  currentView: View;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isSidebarOpen: boolean;
  onOpenPalette: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  setIsSidebarOpen,
  isSidebarOpen,
  onOpenPalette,
}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canUndo = useAppSelector(selectCanUndo);
  const canRedo = useAppSelector(selectCanRedo);

  const handleUndo = () => {
    if (canUndo) {
      dispatch(UndoAction.undo());
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      dispatch(UndoAction.redo());
    }
  };

  const pageTitle = t(viewNavigationLabelKey(currentView));

  return (
    <header
      data-tour="app-header"
      className="
        fixed top-0 left-0 right-0 z-30 h-16
        bg-[var(--sc-surface-raised)]/80 backdrop-blur-2xl
        border-b border-[var(--sc-border-subtle)]
        flex items-center justify-between px-4 sm:px-6
        transition-all duration-300
    "
    >
      {/* Specular highlight at top */}
      <div className="absolute inset-x-0 top-0 h-px bg-[var(--glass-bg-hover)] pointer-events-none" />

      <div className="flex items-center gap-4 flex-shrink-0">
        <button
          type="button"
          onClick={() => setIsSidebarOpen(true)}
          className="md:hidden p-2 -ml-2 text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] transition-colors"
          aria-label={t('header.openMenu')}
          aria-controls="sidebar"
          aria-expanded={isSidebarOpen}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
            aria-hidden="true"
          >
            {ICONS.MENU}
          </svg>
        </button>
        <div className="flex items-center gap-3">
          {/* QNBS-v3: dynamic section icon — color derives from APP_SECTIONS SSOT per currentView */}
          <span className="hidden xs:flex">
            <SectionIcon section={currentView} size="sm" />
          </span>
          <h1 className="text-lg font-bold tracking-tight text-[var(--sc-text-primary)]">
            {pageTitle}
          </h1>
        </div>
      </div>

      <div className="flex-grow max-w-xl px-4 hidden sm:block">
        <Tooltip label={t('tooltip.commandPalette')} shortcut={t('tooltip.commandPaletteShortcut')}>
          <button
            type="button"
            data-tour="command-palette-trigger"
            onClick={onOpenPalette}
            className="w-full h-10 rounded-xl bg-[var(--sc-surface-overlay)]/50 border border-[var(--sc-border-subtle)] hover:border-[var(--border-interactive)] hover:bg-[var(--sc-surface-overlay)] hover:shadow-[var(--sc-shadow-sm)] transition-all flex items-center px-4 text-sm text-[var(--sc-text-muted)] group shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4 mr-3 group-hover:text-[var(--sc-text-primary)] transition-colors"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 001.061 1.061z"
              />
            </svg>
            <span className="flex-grow text-left group-hover:text-[var(--sc-text-secondary)] transition-colors">
              {t('palette.placeholder')}...
            </span>
            <div className="flex gap-1 items-center">
              <kbd className="hidden md:inline-flex items-center h-5 px-2 text-[10px] font-mono font-bold text-[var(--sc-text-muted)] bg-[var(--sc-surface-base)] rounded border border-[var(--sc-border-subtle)] shadow-sm group-hover:border-[var(--sc-border-strong)] transition-colors">
                Ctrl K
              </kbd>
            </div>
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={onOpenPalette}
          className="sm:hidden p-2 text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]"
          aria-label={t('palette.placeholder')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 001.061 1.061z"
            />
          </svg>
        </button>

        <SaveStatusIndicator />

        <div className="w-px h-6 bg-[var(--sc-border-subtle)] mx-1 hidden sm:block"></div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-2 rounded-lg text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-overlay)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            aria-label={t('common.undo')}
            title={t('common.undo')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              {ICONS.UNDO}
            </svg>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-2 rounded-lg text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-overlay)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            aria-label={t('common.redo')}
            title={t('common.redo')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              {ICONS.REDO}
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};
