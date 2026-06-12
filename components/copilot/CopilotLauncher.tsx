import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import { useGlobalCopilot } from '../../hooks/useGlobalCopilot';
import { viewNavigationLabelKey } from '../../services/viewNavigationLabels';
import type { View } from '../../types';
import { Icon } from '../ui/Icon';
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
          className="fixed bottom-20 right-4 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)] shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-2 md:bottom-4"
        >
          <Icon name="sparkles" size="lg" aria-hidden />
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
