import { useMindMapViewContext } from '../../contexts/MindMapViewContext';
import { useTranslation } from '../../hooks/useTranslation';

export function MindMapToolbar() {
  const { t } = useTranslation();
  const { zoom, handleZoom, handleResetViewport } = useMindMapViewContext();

  // QNBS-v3: All dark: stone prefixes replaced with --sc-* tokens — appearance presets now work.
  return (
    <div className="flex items-center gap-2 p-2 border-b border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]">
      <button
        type="button"
        onClick={() => handleZoom(0.1)}
        className="p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-sc-sm hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]"
        aria-label={t('mindmap.zoomIn')}
        title={t('mindmap.zoomIn')}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>

      <span className="text-xs text-[var(--sc-text-muted)] min-w-[3rem] text-center tabular-nums">
        {Math.round(zoom * 100)}%
      </span>

      <button
        type="button"
        onClick={() => handleZoom(-0.1)}
        className="p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-sc-sm hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]"
        aria-label={t('mindmap.zoomOut')}
        title={t('mindmap.zoomOut')}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleResetViewport}
        className="p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-sc-sm hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]"
        aria-label={t('mindmap.resetViewport')}
        title={t('mindmap.resetViewport')}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
    </div>
  );
}
