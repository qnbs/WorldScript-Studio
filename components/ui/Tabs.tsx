import React, { useId } from 'react';

interface Tab {
  id: string;
  label: string;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  ariaLabel: string;
  variant?: 'default' | 'pills' | 'underline';
  className?: string;
}

export const Tabs = React.memo(
  ({ tabs, activeTab, onChange, ariaLabel, variant = 'default', className = '' }: TabsProps) => {
    const groupId = useId();

    const baseTabClasses =
      'relative flex items-center justify-center px-4 py-2 text-sm font-medium transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] disabled:opacity-50 disabled:cursor-not-allowed';

    const variantClasses = {
      default:
        'text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] data-[state=active]:text-[var(--sc-accent)] data-[state=active]:bg-[var(--sc-accent-subtle)] rounded-sc-md',
      pills:
        'text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] data-[state=active]:text-[var(--sc-text-on-accent)] data-[state=active]:bg-[var(--sc-accent)] rounded-full',
      underline:
        'text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] data-[state=active]:text-[var(--sc-text-primary)] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-[var(--sc-accent)] rounded-sc-none',
    };

    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={`flex ${variant === 'underline' ? 'border-b border-[var(--sc-border-subtle)]' : 'bg-[var(--sc-surface-raised)]/50 p-1 rounded-sc-lg'} ${className}`}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${groupId}-${tab.id}-panel`}
              id={`${groupId}-${tab.id}`}
              data-state={isActive ? 'active' : 'inactive'}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={`${baseTabClasses} ${variantClasses[variant]}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  },
);
Tabs.displayName = 'Tabs';

interface TabPanelProps {
  tabId: string;
  activeTab: string;
  groupId: string;
  children: React.ReactNode;
  className?: string;
}

export const TabPanel = React.memo(
  ({ tabId, activeTab, groupId, children, className = '' }: TabPanelProps) => {
    const isActive = activeTab === tabId;
    return (
      <section
        role="tabpanel"
        id={`${groupId}-${tabId}-panel`}
        aria-labelledby={`${groupId}-${tabId}`}
        hidden={!isActive}
        className={isActive ? className : 'hidden'}
      >
        {children}
      </section>
    );
  },
);
TabPanel.displayName = 'TabPanel';
