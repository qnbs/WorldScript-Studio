import React from 'react';
import { ActionCreators as UndoAction } from 'redux-undo';
import { ICONS } from '../constants';
import { useTranslation } from '../hooks/useTranslation';
import { SaveStatusIndicator } from './ui/SaveStatusIndicator';
import { selectCanUndo, selectCanRedo } from '../features/project/projectSelectors';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import type { View } from '../types';

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

  const viewTitleMap: Record<View, string> = {
    dashboard: 'sidebar.dashboard',
    manuscript: 'sidebar.manuscript',
    writer: 'sidebar.writer',
    templates: 'sidebar.templates',
    outline: 'sidebar.outline',
    characters: 'sidebar.characters',
    world: 'sidebar.world',
    export: 'sidebar.export',
    settings: 'sidebar.settings',
    help: 'sidebar.help',
  };

  const pageTitle = t(viewTitleMap[currentView] || 'sidebar.dashboard');

  return (
    <header
      className="
        fixed top-0 left-0 right-0 z-30 h-16
        bg-[var(--background-secondary)]/80 backdrop-blur-2xl
        border-b border-[var(--border-primary)]
        flex items-center justify-between px-4 sm:px-6
        transition-all duration-300
    "
    >
      {/* Specular highlight at top */}
      <div className="absolute inset-x-0 top-0 h-px bg-white/10 pointer-events-none" />

      <div className="flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="md:hidden p-2 -ml-2 text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] transition-colors"
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
          <div className="p-1.5 rounded-lg bg-indigo-500/10 hidden xs:block" aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5 text-[var(--background-interactive)]"
              aria-hidden="true"
            >
              {ICONS.WRITER}
            </svg>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--foreground-primary)]">
            {pageTitle}
          </h1>
        </div>
      </div>

      <div className="flex-grow max-w-xl px-4 hidden sm:block">
        <button
          onClick={onOpenPalette}
          className="w-full h-10 rounded-xl bg-[var(--background-tertiary)]/50 border border-[var(--border-primary)] hover:border-[var(--border-interactive)] hover:bg-[var(--background-tertiary)] hover:shadow-[var(--shadow-sm)] transition-all flex items-center px-4 text-sm text-[var(--foreground-muted)] group shadow-sm"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-4 h-4 mr-3 group-hover:text-[var(--foreground-primary)] transition-colors"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 001.061 1.061z"
            />
          </svg>
          <span className="flex-grow text-left group-hover:text-[var(--foreground-secondary)] transition-colors">
            {t('palette.placeholder')}...
          </span>
          <div className="flex gap-1 items-center">
            <kbd className="hidden md:inline-flex items-center h-5 px-2 text-[10px] font-mono font-bold text-[var(--foreground-muted)] bg-[var(--background-primary)] rounded border border-[var(--border-primary)] shadow-sm group-hover:border-[var(--border-highlight)] transition-colors">
              Ctrl K
            </kbd>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <button
          onClick={onOpenPalette}
          className="sm:hidden p-2 text-[var(--foreground-secondary)] hover:text-[var(--foreground-primary)]"
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

        <div className="w-px h-6 bg-[var(--border-primary)] mx-1 hidden sm:block"></div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-2 rounded-lg text-[var(--foreground-secondary)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-2 rounded-lg text-[var(--foreground-secondary)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
