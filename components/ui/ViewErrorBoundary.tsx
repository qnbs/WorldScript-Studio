import type { FC, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import { useTranslation } from '../../hooks/useTranslation';
import { ErrorBoundary } from './ErrorBoundary';

export interface ViewErrorBoundaryProps {
  children: ReactNode;
  viewLabel?: string;
}

/** Nested error boundary for lazy views with retry + screen-reader announcement. */
export const ViewErrorBoundary: FC<ViewErrorBoundaryProps> = ({ children, viewLabel }) => {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const [retryKey, setRetryKey] = useState(0);

  const handleReset = useCallback(() => {
    setRetryKey((k) => k + 1);
    announce(
      viewLabel
        ? t('error.boundary.retryAnnouncement', { view: viewLabel })
        : t('error.boundary.retryAnnouncementGeneric'),
    );
  }, [announce, t, viewLabel]);

  return (
    <ErrorBoundary onReset={handleReset}>
      <div key={retryKey} className="h-full w-full min-h-0">
        {children}
      </div>
    </ErrorBoundary>
  );
};
ViewErrorBoundary.displayName = 'ViewErrorBoundary';
