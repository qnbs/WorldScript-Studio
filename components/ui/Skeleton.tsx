import type React from 'react';

// QNBS-v3 (Visual Maturity #E, DS-6): --sc-surface-overlay replaces the raw --glass-bg-hover token — a loading placeholder has no blur/glass surface, so it belongs in the same semantic surface family as the rest of the app.
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={`animate-pulse rounded-md bg-[var(--sc-surface-overlay)] ${className}`}></div>
  );
};
Skeleton.displayName = 'Skeleton';
