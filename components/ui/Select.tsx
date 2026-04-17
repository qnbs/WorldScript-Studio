import React from 'react';

export const Select = React.memo(
  React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
    ({ className, children, ...props }, ref) => {
      return (
        <div className="relative w-full group">
          <select
            className={`
            flex h-11 w-full appearance-none rounded-xl
            border border-[var(--border-primary)] 
            bg-[var(--glass-bg)] backdrop-blur-md
            px-4 py-2.5 pr-10 text-sm 
            text-[var(--foreground-primary)] 
            shadow-sm transition-all duration-200
            focus:outline-none focus:border-[var(--border-interactive)] focus:ring-4 focus:ring-[var(--ring-focus)] focus:bg-[var(--background-secondary)]/50
            hover:border-[var(--border-highlight)] hover:bg-[var(--glass-bg-hover)]
            disabled:opacity-50 disabled:cursor-not-allowed
            cursor-pointer
            [&>option]:bg-[var(--background-secondary)] [&>option]:text-[var(--foreground-primary)]
            ${className}
          `}
            ref={ref}
            {...props}
          >
            {children}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--foreground-muted)] group-hover:text-[var(--foreground-primary)] transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
              />
            </svg>
          </div>
        </div>
      );
    },
  ),
);
Select.displayName = 'Select';
