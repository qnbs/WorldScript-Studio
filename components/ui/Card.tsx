import type React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  as: Component = 'div',
  ...props
}) => {
  const isInteractive = Component === 'button';

  return (
    <Component
      type={isInteractive ? 'button' : undefined}
      className={`
        relative group rounded-sc-xl
        bg-[var(--sc-surface-raised)]/60 backdrop-blur-3xl
        border border-[var(--glass-border)]
        shadow-[var(--sc-shadow-lg)]
        transition-all duration-sc-normal ease-out
        ${isInteractive ? 'hover:-translate-y-1 hover:shadow-[var(--sc-shadow-xl)] hover:bg-[var(--sc-surface-raised)]/80 cursor-pointer active:scale-[0.99]' : ''} 
        ${className ?? ''}
      `}
      {...props}
    >
      {/* Inner Border Gradient - gives a subtle high-end look */}
      <div className="absolute inset-0 rounded-sc-xl border border-[var(--glass-border)] pointer-events-none" />
      <div className="absolute inset-0 rounded-sc-xl border border-transparent group-hover:border-[var(--sc-accent)]/20 transition-colors duration-500 pointer-events-none" />

      {/* Specular Highlight - Simulates light hitting the top edge of glass */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--glass-highlight)] to-transparent opacity-50 pointer-events-none" />

      {/* Spotlight Effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--sc-accent)]/0 via-[var(--sc-accent)]/5 to-[var(--sc-accent)]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 blur-lg pointer-events-none" />

      <div className="relative z-10 h-full flex flex-col">{children}</div>
    </Component>
  );
};

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}

export const CardContent: React.FC<CardContentProps> = ({ children, className }) => {
  return <div className={`p-6 text-[var(--sc-text-secondary)] ${className ?? ''}`}>{children}</div>;
};

interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ children, className }) => {
  return (
    <div
      className={`p-6 border-b border-[var(--sc-border-subtle)]/50 bg-[var(--sc-surface-raised)]/[0.02] ${className ?? ''}`}
    >
      {children}
    </div>
  );
};
Card.displayName = 'Card';
CardContent.displayName = 'CardContent';
CardHeader.displayName = 'CardHeader';
