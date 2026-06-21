import type { FC, ReactNode } from 'react';
import React from 'react';

export const ToggleSwitch: FC<{
  label?: string;
  // QNBS-v3: allow explicit `undefined` (exactOptionalPropertyTypes) so callers can pass a computed
  // `string | undefined` hint without a conditional-spread dance.
  hint?: string | undefined;
  // QNBS-v3: optional inline status pill (e.g. <Badge variant="experimental" />) rendered after the
  // label. Kept as ReactNode so callers control the badge variant/text without coupling this atom.
  badge?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  // QNBS-v3: optional disabled state — used to block a dependent flag toggle until its prerequisite
  // is enabled. The hint explains why; the switch is non-interactive but still announced to AT.
  disabled?: boolean;
}> = React.memo(({ label, hint, badge, checked, onChange, ariaLabel, disabled = false }) => {
  const labelId = React.useId();
  const hintId = React.useId();
  // QNBS-v3: Ensure switch always has an accessible name (CodeAnt AI fix)
  const accessibleName = ariaLabel ?? label ?? 'Toggle';
  return (
    <div className="flex items-start justify-between gap-3">
      {(label ?? hint) && (
        <div className="flex flex-col gap-0.5 min-w-0">
          {(label || badge) && (
            <span className="flex items-center gap-2 flex-wrap">
              {label && (
                <span id={labelId} className="text-sm font-medium text-[var(--sc-text-secondary)]">
                  {label}
                </span>
              )}
              {badge}
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
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`${
          checked
            ? 'bg-[var(--sc-accent)] border-[var(--sc-accent)]'
            : 'bg-[var(--sc-surface-overlay)]/40 border-[var(--sc-border-subtle)]'
        } ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:border-[var(--sc-border-strong)]'
        } relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border transition-colors duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sc-surface-base)]`}
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
