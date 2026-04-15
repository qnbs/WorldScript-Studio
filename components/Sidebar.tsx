import React, { useEffect } from 'react';
import type { View } from '../types';
import { ICONS } from '../constants';
import { useTranslation } from '../hooks/useTranslation';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
}

const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ icon, label, isActive, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center w-full px-4 py-3 text-left rounded-xl transition-all duration-300 group touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] overflow-hidden ${
        isActive
          ? 'bg-gradient-to-r from-[var(--nav-background-active)] to-transparent text-[var(--nav-text-active)] shadow-sm font-semibold'
          : 'text-[var(--foreground-secondary)] hover:bg-[var(--nav-background-hover)] hover:text-[var(--foreground-primary)] font-medium'
      }`}
      aria-current={isActive ? 'page' : undefined}
    >
      {isActive && (
        <>
          <span className="absolute left-0 h-full top-0 w-1 bg-[var(--nav-border-active)] shadow-[0_0_15px_2px_var(--nav-border-active)]"></span>
          <span className="absolute inset-0 bg-gradient-to-r from-[var(--nav-border-active)]/10 to-transparent pointer-events-none"></span>
        </>
      )}
      <div className={`relative z-10 flex items-center`}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={isActive ? 2 : 1.5}
          stroke="currentColor"
          className={`w-5 h-5 mr-3 transition-transform duration-300 ${isActive ? 'scale-110 text-[var(--nav-text-active)]' : 'group-hover:scale-110 text-[var(--foreground-muted)] group-hover:text-[var(--foreground-primary)]'}`}
          aria-hidden="true"
        >
          {icon}
        </svg>
        <span className="text-sm tracking-wide">{label}</span>
      </div>
    </button>
  );
});
NavItem.displayName = 'NavItem';

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isSidebarOpen,
  setIsSidebarOpen,
}) => {
  const { t } = useTranslation();

  const handleNavigation = (view: View) => {
    onNavigate(view);
    setIsSidebarOpen(false);
  };

  // Close sidebar on Escape key (mobile)
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen, setIsSidebarOpen]);

  const navItems = [
    { id: 'dashboard', label: t('sidebar.dashboard'), icon: ICONS.DASHBOARD },
    { id: 'manuscript', label: t('sidebar.manuscript'), icon: ICONS.WRITER },
    { id: 'writer', label: t('sidebar.writer'), icon: ICONS.SPARKLES },
    { id: 'templates', label: t('sidebar.templates'), icon: ICONS.TEMPLATES },
    { id: 'outline', label: t('sidebar.outline'), icon: ICONS.OUTLINE },
    {
      id: 'characters',
      label: t('sidebar.characters'),
      icon: ICONS.CHARACTERS,
    },
    { id: 'world', label: t('sidebar.world'), icon: ICONS.WORLD },
    {
      id: 'sceneboard',
      label: t('sidebar.sceneboard'),
      icon: ICONS.SCENEBOARD,
    },
    {
      id: 'characterGraph',
      label: t('sidebar.characterGraph'),
      icon: ICONS.CHARACTERGRAPH,
    },
    {
      id: 'consistencyChecker',
      label: t('sidebar.consistencyChecker'),
      icon: ICONS.CONSISTENCYCHECKER,
    },
    { id: 'critic', label: t('sidebar.critic'), icon: ICONS.CRITIC },
    { id: 'export', label: t('sidebar.export'), icon: ICONS.EXPORT },
  ];

  const bottomNavItems = [
    { id: 'settings', label: t('sidebar.settings'), icon: ICONS.SETTINGS },
    { id: 'help', label: t('sidebar.help'), icon: ICONS.HELP },
  ];

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-30 transition-opacity duration-300 md:hidden ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsSidebarOpen(false)}
        aria-hidden="true"
      />

      <aside
        id="sidebar"
        aria-label="Hauptnavigation"
        aria-hidden={!isSidebarOpen ? true : undefined}
        className={`
        bg-[var(--background-secondary)]/95 backdrop-blur-3xl
        w-[85vw] max-w-xs md:w-64 fixed top-0 left-0 h-[100dvh] z-40 
        flex flex-col justify-between 
        transform transition-transform duration-300 cubic-bezier(0.2, 0.8, 0.2, 1) 
        md:translate-x-0 
        ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'} 
        border-r border-[var(--border-primary)]
        md:bg-transparent md:border-r md:border-[var(--border-primary)]
        md:top-16 md:h-[calc(100vh-4rem)]
        py-4 px-3
      `}
      >
        <div className="flex-grow flex flex-col overflow-y-auto no-scrollbar space-y-6">
          <div className="md:hidden h-12 flex items-center px-4 mb-2">
            <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              StoryCraft
            </h2>
          </div>
          <nav className="flex flex-col space-y-1.5" aria-label="Main navigation">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                isActive={currentView === item.id}
                onClick={() => handleNavigation(item.id as View)}
              />
            ))}
          </nav>
        </div>
        <nav
          className="flex flex-col space-y-1.5 mt-4 border-t border-[var(--border-primary)] pt-4"
          aria-label="Secondary navigation"
        >
          {bottomNavItems.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              isActive={currentView === item.id}
              onClick={() => handleNavigation(item.id as View)}
            />
          ))}
        </nav>
      </aside>
    </>
  );
};
