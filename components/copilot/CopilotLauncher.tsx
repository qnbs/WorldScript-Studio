import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import { useGlobalCopilot } from '../../hooks/useGlobalCopilot';
import { viewNavigationLabelKey } from '../../services/viewNavigationLabels';
import type { View } from '../../types';
import { CopilotPanel } from './CopilotPanel';

interface CopilotLauncherProps {
  currentView: View;
  onNavigate?: (view: View) => void;
}

/**
 * Global Copilot entry point — a floating action button that toggles the assistant panel.
 * QNBS-v3: Mounted in App.tsx behind the enableGlobalCopilot flag. Context-aware via currentView.
 */
export const CopilotLauncher: FC<CopilotLauncherProps> = ({ currentView, onNavigate }) => {
  const copilot = useGlobalCopilot(currentView);
  const { t, isOpen, open } = copilot;
  const announce = useAnnounce();
  const wasOpen = useRef(isOpen);

  // QNBS-v3: WCAG 4.1.3 — announce open/close state changes for screen-reader users.
  useEffect(() => {
    if (isOpen !== wasOpen.current) {
      announce(isOpen ? t('copilot.announceOpened') : t('copilot.announceClosed'), 'polite');
      wasOpen.current = isOpen;
    }
  }, [isOpen, announce, t]);

  const contextLabel = t('copilot.contextLabel', {
    view: t(viewNavigationLabelKey(currentView)),
  });

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={open}
          aria-label={t('copilot.launcherLabel')}
          aria-expanded={isOpen}
          // QNBS-v3: on <md the mobile bottom-nav (Sidebar `data-tour="nav-mobile"`, fixed bottom-0)
          // occupies the same corner; bottom-4 put this z-90 FAB on top of the "More" tab and ate its
          // taps (broke all mobile clickNavItem E2E). Raise it clear of the bar on mobile, normal on md+.
          className="fixed bottom-20 right-4 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-[var(--sc-accent)] text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] focus-visible:ring-offset-2 md:bottom-4"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-icon-sc-lg h-icon-sc-lg"
            aria-hidden="true"
          >
            <path d="M12 2a1 1 0 0 1 .92.61l1.2 2.87 2.87 1.2a1 1 0 0 1 0 1.84l-2.87 1.2-1.2 2.87a1 1 0 0 1-1.84 0l-1.2-2.87-2.87-1.2a1 1 0 0 1 0-1.84l2.87-1.2 1.2-2.87A1 1 0 0 1 12 2zM5 14a1 1 0 0 1 .92.61l.63 1.5 1.5.63a1 1 0 0 1 0 1.84l-1.5.63-.63 1.5a1 1 0 0 1-1.84 0l-.63-1.5-1.5-.63a1 1 0 0 1 0-1.84l1.5-.63.63-1.5A1 1 0 0 1 5 14z" />
          </svg>
        </button>
      )}
      {isOpen && (
        <CopilotPanel
          copilot={copilot}
          contextLabel={contextLabel}
          // QNBS-v3: exactOptionalPropertyTypes — only spread when defined to avoid passing undefined.
          {...(onNavigate ? { onNavigate } : {})}
        />
      )}
    </>
  );
};
