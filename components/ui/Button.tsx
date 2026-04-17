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
        'relative inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-primary)] disabled:opacity-50 disabled:pointer-events-none active:scale-[0.96] select-none tracking-tight overflow-hidden';

      const variantClasses = {
        primary:
          'bg-[var(--background-interactive)] hover:bg-[var(--background-interactive-hover)] text-white shadow-[0_4px_14px_0_rgba(99,102,241,0.39)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.23)] border border-indigo-500/20',
        secondary:
          'bg-[var(--background-tertiary)] hover:bg-[var(--background-secondary)] text-[var(--foreground-primary)] border border-[var(--border-primary)] shadow-sm hover:shadow-md hover:border-[var(--foreground-muted)]/30',
        danger:
          'bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 hover:border-red-500/30 active:bg-red-500/30',
        ghost:
          'text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-tertiary)] hover:shadow-sm',
        outline:
          'bg-transparent text-[var(--foreground-primary)] border border-[var(--border-primary)] hover:bg-[var(--background-secondary)]',
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
