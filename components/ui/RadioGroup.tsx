import React, { useId } from 'react';

interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface RadioGroupProps {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  name: string;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

export const RadioGroup = React.memo(
  ({
    options,
    value,
    onChange,
    name,
    orientation = 'vertical',
    className = '',
  }: RadioGroupProps) => {
    const groupId = useId();
    const radioName = name ?? groupId;

    return (
      <div
        role="radiogroup"
        aria-label={name}
        className={`flex ${orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-4'} gap-2 ${className}`}
      >
        {options.map((option) => {
          const checked = value === option.value;
          const itemId = `${groupId}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-3">
              <div className="relative flex items-center">
                <input
                  type="radio"
                  id={itemId}
                  name={radioName}
                  value={option.value}
                  checked={checked}
                  onChange={() => onChange(option.value)}
                  disabled={option.disabled}
                  className={`
                    peer h-5 w-5 appearance-none rounded-full
                    border border-[var(--sc-border-subtle)]
                    bg-[var(--glass-bg)] backdrop-blur-sm
                    checked:border-[var(--sc-accent)] checked:bg-[var(--sc-accent)]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--sc-surface-base)]
                    transition-all duration-sc-fast cursor-pointer
                    hover:border-[var(--sc-border-strong)] hover:bg-[var(--glass-bg-hover)]
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                />
                {/* Inner dot for checked state */}
                <span
                  className={`
                    pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                    h-2.5 w-2.5 rounded-full bg-[var(--sc-text-on-accent)]
                    opacity-0 peer-checked:opacity-100 transition-opacity duration-sc-fast
                  `}
                />
              </div>
              <div className="flex-1 min-w-0">
                <label
                  htmlFor={itemId}
                  className={`
                    block text-sm font-medium text-[var(--sc-text-secondary)]
                    peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
                    hover:text-[var(--sc-text-primary)] cursor-pointer select-none transition-colors
                  `}
                >
                  {option.label}
                </label>
                {option.description && (
                  <p className="mt-0.5 text-xs text-[var(--sc-text-muted)]">{option.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  },
);
RadioGroup.displayName = 'RadioGroup';
