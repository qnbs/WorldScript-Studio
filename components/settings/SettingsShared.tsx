import type { FC } from 'react';
import React from 'react';

export const ToggleSwitch: FC<{
  label?: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}> = React.memo(({ label, hint, checked, onChange, ariaLabel }) => {
  const labelId = React.useId();
  const hintId = React.useId();
  // QNBS-v3: Ensure switch always has an accessible name (CodeAnt AI fix)
  const accessibleName = ariaLabel ?? label ?? 'Toggle';
  return (
    <div className="flex items-start justify-between gap-3">
      {(label ?? hint) && (
        <div className="flex flex-col gap-0.5 min-w-0">
          {label && (
            <span id={labelId} className="text-sm font-medium text-[var(--sc-text-secondary)]">
              {label}
            </span>
          )}
          {hint && (
            <span id={hintId} className="text-xs text-[var(--sc-text-muted)]">
              {hint}
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={accessibleName}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => onChange(!checked)}
        className={`${
          checked
            ? 'bg-[var(--sc-accent)] border-[var(--sc-accent)]'
            : 'bg-[var(--sc-surface-overlay)]/40 border-[var(--sc-border-subtle)]'
        } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border transition-colors duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sc-surface-base)] hover:border-[var(--sc-border-strong)]`}
      >
        {/* QNBS-v3: --sc-surface-base adapts to all themes; bg-white breaks sepia/high-contrast */}
        {/* Reduced motion: disable transform transition */}
        <span
          className={`${checked ? '[dir:ltr]:translate-x-5 [dir:rtl]:-translate-x-5' : 'translate-x-0'} inline-block h-5 w-5 transform rounded-full bg-[var(--sc-surface-base)] shadow ring-0 transition-transform duration-sc-fast ease-in-out`}
        />
      </button>
    </div>
  );
});
ToggleSwitch.displayName = 'ToggleSwitch';
