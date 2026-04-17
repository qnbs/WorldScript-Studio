import type React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => {
  return <div className={`animate-pulse rounded-md bg-[var(--glass-bg-hover)] ${className}`}></div>;
};
