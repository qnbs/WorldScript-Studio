import type React from 'react';

interface ProgressProps {
  value: number; // 0 to 100
  className?: string;
}

export const Progress: React.FC<ProgressProps> = ({ value, className }) => {
  const progress = Math.max(0, Math.min(100, value));

  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-[var(--background-tertiary)] ${className}`}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};
