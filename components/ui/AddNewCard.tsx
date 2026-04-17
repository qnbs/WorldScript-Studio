import type React from 'react';

interface AddNewCardProps {
  title: string;
  description: string;
  onClick: () => void;
  icon: React.ReactNode;
  variant?: 'default' | 'primary';
}

export const AddNewCard: React.FC<AddNewCardProps> = ({
  title,
  description,
  onClick,
  icon,
  variant = 'primary',
}) => {
  const baseClasses =
    'relative flex flex-col items-center justify-center text-center rounded-2xl min-h-[280px] p-8 transition-all duration-300 group cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-primary)] active:scale-[0.98]';

  const variantClasses = {
    default:
      'bg-[var(--background-secondary)]/30 hover:bg-[var(--background-secondary)] border-2 border-dashed border-[var(--border-primary)] hover:border-solid hover:border-[var(--foreground-muted)]/50 hover:shadow-lg',
    primary:
      'bg-gradient-to-br from-[var(--background-interactive)]/5 to-[var(--background-interactive)]/10 hover:from-[var(--background-interactive)]/10 hover:to-[var(--background-interactive)]/20 border-2 border-dashed border-[var(--background-interactive)]/30 hover:border-solid hover:border-[var(--background-interactive)]/50 hover:shadow-[0_0_30px_-5px_var(--background-interactive-subtle)]',
  };

  const iconContainerClasses = {
    default:
      'bg-[var(--background-tertiary)] text-[var(--foreground-secondary)] group-hover:scale-110 group-hover:bg-[var(--background-secondary)] group-hover:text-[var(--foreground-primary)] group-hover:shadow-md',
    primary:
      'bg-[var(--background-interactive)]/10 text-[var(--background-interactive)] group-hover:scale-110 group-hover:bg-[var(--background-interactive)] group-hover:text-white shadow-sm group-hover:shadow-[0_0_15px_var(--background-interactive)]',
  };

  const titleClasses = 'text-lg font-bold text-[var(--foreground-primary)] mb-2 tracking-tight';

  const descriptionClasses = {
    default:
      'text-sm text-[var(--foreground-muted)] group-hover:text-[var(--foreground-secondary)] transition-colors',
    primary:
      'text-sm text-[var(--background-interactive)]/80 dark:text-indigo-200/80 group-hover:text-[var(--background-interactive)] dark:group-hover:text-indigo-100 transition-colors',
  };

  return (
    <button onClick={onClick} className={`${baseClasses} ${variantClasses[variant]}`}>
      <div
        className={`mx-auto rounded-2xl p-5 mb-6 transition-all duration-300 ${iconContainerClasses[variant]}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-8 h-8"
        >
          {icon}
        </svg>
      </div>
      <h3 className={titleClasses}>{title}</h3>
      <p className={descriptionClasses[variant]}>{description}</p>

      {/* Subtle highlight overlay */}
      <div className="absolute inset-0 bg-white/0 group-hover:bg-[var(--glass-bg)] transition-colors duration-300 pointer-events-none" />
    </button>
  );
};
