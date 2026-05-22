import type { FC } from 'react';
import React from 'react';

export const ToggleSwitch: FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = React.memo(({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-[var(--sc-text-secondary)]">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`${checked ? 'bg-[var(--sc-accent)] border-[var(--sc-accent)]' : 'bg-[var(--sc-surface-overlay)]/40 border-[var(--sc-border-subtle)]'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--sc-ring-focus)] focus:ring-offset-2 focus:ring-offset-[var(--sc-surface-base)] hover:border-[var(--sc-border-strong)]`}
    >
      <span
        className={`${checked ? 'translate-x-5' : 'translate-x-0'} inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
      />
    </button>
  </div>
));
ToggleSwitch.displayName = 'ToggleSwitch';
