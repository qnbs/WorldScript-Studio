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
    'relative flex flex-col items-center justify-center text-center rounded-2xl min-h-[280px] p-8 transition-all duration-sc-normal group cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sc-surface-base)] active:scale-[0.98]';

  const variantClasses = {
    default:
      'bg-[var(--sc-surface-raised)]/30 hover:bg-[var(--sc-surface-raised)] border-2 border-dashed border-[var(--sc-border-subtle)] hover:border-solid hover:border-[var(--sc-text-muted)]/50 hover:shadow-lg',
    primary:
      'bg-gradient-to-br from-[var(--sc-accent)]/5 to-[var(--sc-accent)]/10 hover:from-[var(--sc-accent)]/10 hover:to-[var(--sc-accent)]/20 border-2 border-dashed border-[var(--sc-accent)]/30 hover:border-solid hover:border-[var(--sc-accent)]/50 hover:shadow-[0_0_30px_-5px_var(--sc-accent-subtle)]',
  };

  const iconContainerClasses = {
    default:
      'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)] group-hover:scale-110 group-hover:bg-[var(--sc-surface-raised)] group-hover:text-[var(--sc-text-primary)] group-hover:shadow-md',
    primary:
      'bg-[var(--sc-accent)]/10 text-[var(--sc-accent)] group-hover:scale-110 group-hover:bg-[var(--sc-accent)] group-hover:text-white shadow-sm group-hover:shadow-[0_0_15px_var(--sc-accent)]',
  };

  const titleClasses = 'text-lg font-bold text-[var(--sc-text-primary)] mb-2 tracking-tight';

  const descriptionClasses = {
    default:
      'text-sm text-[var(--sc-text-muted)] group-hover:text-[var(--sc-text-secondary)] transition-colors',
    primary:
      'text-sm text-[var(--sc-accent)]/80 dark:text-indigo-200/80 group-hover:text-[var(--sc-accent)] dark:group-hover:text-indigo-100 transition-colors',
  };

  return (
    <button type="button" onClick={onClick} className={`${baseClasses} ${variantClasses[variant]}`}>
      <div
        className={`mx-auto rounded-2xl p-5 mb-6 transition-all duration-sc-normal ${iconContainerClasses[variant]}`}
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
      <div className="absolute inset-0 bg-white/0 group-hover:bg-[var(--glass-bg)] transition-colors duration-sc-normal pointer-events-none" />
    </button>
  );
};
