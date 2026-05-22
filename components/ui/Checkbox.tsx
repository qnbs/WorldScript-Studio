import React from 'react';

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Checkbox = React.memo(
  React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, label, id, ...props }, ref) => {
    return (
      <div className="flex items-center group">
        <div className="relative flex items-center">
          <input
            type="checkbox"
            id={id}
            ref={ref}
            className={`
              peer h-5 w-5 appearance-none rounded-md
              border border-[var(--sc-border-subtle)]
              bg-[var(--glass-bg)] backdrop-blur-sm
              checked:bg-[var(--sc-accent)] checked:border-[var(--sc-accent)]
              focus:outline-none focus:ring-2 focus:ring-[var(--sc-ring-focus)] focus:ring-offset-1 focus:ring-offset-[var(--sc-surface-base)]
              transition-all duration-sc-fast cursor-pointer
              hover:border-[var(--sc-border-strong)] hover:bg-[var(--glass-bg-hover)]
              ${className}
            `}
            {...props}
          />
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-sc-fast"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        {label && (
          <label
            htmlFor={id}
            className="ml-3 text-sm font-medium text-[var(--sc-text-secondary)] group-hover:text-[var(--sc-text-primary)] cursor-pointer select-none transition-colors"
          >
            {label}
          </label>
        )}
      </div>
    );
  }),
);
Checkbox.displayName = 'Checkbox';
