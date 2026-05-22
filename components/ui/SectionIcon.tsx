// QNBS-v3: App-wide colored icon badge — derives color+icon from APP_SECTIONS (SSOT)
import type { FC } from 'react';
import { APP_SECTIONS } from '../../constants/sections';
import type { View } from '../../types';

type SectionIconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<SectionIconSize, { container: string; svg: string }> = {
  xs: { container: 'p-1.5 rounded-lg', svg: 'w-3.5 h-3.5' },
  sm: { container: 'p-2 rounded-xl', svg: 'w-4 h-4' },
  md: { container: 'p-2.5 rounded-xl', svg: 'w-5 h-5' },
  lg: { container: 'p-3 rounded-2xl', svg: 'w-6 h-6' },
  xl: { container: 'p-4 rounded-2xl', svg: 'w-7 h-7' },
};

interface SectionIconProps {
  section: View;
  size?: SectionIconSize;
  className?: string;
}

export const SectionIcon: FC<SectionIconProps> = ({ section, size = 'md', className }) => {
  const config = APP_SECTIONS[section];
  const sizes = SIZE_CLASSES[size];
  return (
    <div
      className={`${sizes.container} ${config.colorClass} border border-current/15 flex-shrink-0 ${className ?? ''}`}
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className={sizes.svg}
      >
        {config.icon}
      </svg>
    </div>
  );
};
SectionIcon.displayName = 'SectionIcon';
