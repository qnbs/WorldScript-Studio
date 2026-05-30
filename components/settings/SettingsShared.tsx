import type { FC } from 'react';
import React from 'react';

export const ToggleSwitch: FC<{
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}> = React.memo(({ label, checked, onChange, ariaLabel }) => (
  <div className="flex items-center justify-between">
    {label && <span className="text-sm font-medium text-[var(--sc-text-secondary)]">{label}</span>}
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      onClick={() => onChange(!checked)}
      className={`${checked ? 'bg-[var(--sc-accent)] border-[var(--sc-accent)]' : 'bg-[var(--sc-surface-overlay)]/40 border-[var(--sc-border-subtle)]'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sc-surface-base)] hover:border-[var(--sc-border-strong)]`}
    >
      {/* QNBS-v3: --sc-surface-base adapts to all themes; bg-white breaks sepia/high-contrast */}
      <span
        className={`${checked ? 'translate-x-5' : 'translate-x-0'} inline-block h-5 w-5 transform rounded-full bg-[var(--sc-surface-base)] shadow ring-0 transition duration-200 ease-in-out`}
      />
    </button>
  </div>
));
ToggleSwitch.displayName = 'ToggleSwitch';
