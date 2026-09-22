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
      // QNBS-v3 (Visual Maturity #B, DS-6): a solid surface + semantic elevation/radius roles replace the glass-panel treatment — a card reads as a document panel, not a floating glass tile; interactive affordance is border/shadow only, no hover lift or scale.
      className={`
        relative group rounded-[var(--sc-radius-panel)]
        bg-[var(--sc-surface-raised)]
        border border-[var(--sc-border-subtle)]
        shadow-[var(--sc-elevation-surface)]
        transition-colors duration-sc-normal ease-out
        ${isInteractive ? 'hover:border-[var(--sc-border-strong)] hover:shadow-[var(--sc-elevation-popover)] cursor-pointer' : ''}
        ${className ?? ''}
      `}
      {...props}
    >
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
