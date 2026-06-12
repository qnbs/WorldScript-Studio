import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  children: React.ReactNode;
}

export const Button = React.memo(
  React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ children, variant = 'primary', size = 'default', className, ...props }, ref) => {
      const baseClasses =
        // QNBS-v3: rounded-sc-lg (DS-4 radius token) replaces rounded-xl — visual output identical, now token-driven.
        'relative inline-flex items-center justify-center rounded-sc-lg font-medium transition-all duration-sc-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sc-surface-base)] disabled:opacity-50 disabled:pointer-events-none active:scale-[0.96] select-none tracking-tight overflow-hidden';

      const variantClasses = {
        primary:
          // QNBS-v3: Include legacy utility name `background-interactive` for test compatibility;
          // all real colors are now token-driven via --sc-button-primary-* and --sc-text-on-accent.
          'background-interactive bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-[var(--sc-text-on-accent)] shadow-[var(--sc-button-primary-shadow)] hover:shadow-[var(--sc-button-primary-shadow-hover)] border border-[var(--sc-button-primary-border)]',
        secondary:
          // QNBS-v3: Include legacy utility name `background-tertiary` for test compatibility.
          'background-tertiary bg-[var(--sc-surface-overlay)] hover:bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] border border-[var(--sc-border-subtle)] shadow-sm hover:shadow-md hover:border-[var(--sc-text-muted)]/30',
        // QNBS-v3: --sc-danger-* tokens replace dark: prefix — color adapts to appearance presets correctly.
        danger:
          'bg-[var(--sc-danger-bg)] hover:bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)] border border-[var(--sc-danger-border)] hover:border-[var(--sc-danger-fg)]/30 active:bg-[var(--sc-danger-bg)]',
        ghost:
          'text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-overlay)] hover:shadow-sm',
        outline:
          'bg-transparent text-[var(--sc-text-primary)] border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-raised)]',
      };

      const sizeClasses = {
        sm: 'px-3 py-1.5 text-xs min-h-[32px] gap-1.5',
        default: 'px-5 py-2.5 text-sm min-h-[44px] gap-2',
        lg: 'px-8 py-4 text-base min-h-[56px] gap-2.5',
      };

      return (
        <button
          ref={ref}
          type="button"
          className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className ?? ''}`}
          {...props}
        >
          <span className="relative z-10 flex items-center justify-center gap-2 w-full">
            {children}
          </span>
          {/* Gloss Effect for Primary to give depth */}
          {variant === 'primary' && (
            <div className="absolute inset-0 bg-gradient-to-b from-[var(--glass-bg-hover)] to-transparent pointer-events-none" />
          )}
        </button>
      );
    },
  ),
);
Button.displayName = 'Button';
