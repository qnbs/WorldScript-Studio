import type { FC } from 'react';
import React from 'react';

export const ToggleSwitch: FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = React.memo(({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-[var(--foreground-secondary)]">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`${checked ? 'bg-[var(--background-interactive)] border-[var(--background-interactive)]' : 'bg-[var(--background-tertiary)]/40 border-[var(--border-primary)]'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] focus:ring-offset-2 focus:ring-offset-[var(--background-primary)] hover:border-[var(--border-highlight)]`}
    >
      <span
        className={`${checked ? 'translate-x-5' : 'translate-x-0'} inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
      />
    </button>
  </div>
));
ToggleSwitch.displayName = 'ToggleSwitch';
