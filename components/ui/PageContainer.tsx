import type { FC, ReactNode } from 'react';

/** Desktop work-width variant. Maps to the `--width-content*` token family (index.css). */
export type PageContainerWidth = 'narrow' | 'default' | 'wide';

interface PageContainerProps {
  children: ReactNode;
  /**
   * Desktop content-width variant:
   *  - `narrow` (48rem) — single-column reading / forms
   *  - `default` (72rem) — general work-content (default)
   *  - `wide` (90rem) — multi-column dashboards / grids
   */
  width?: PageContainerWidth;
  /** Extra classes merged onto the shell (e.g. spacing overrides). */
  className?: string;
}

const WIDTH_CLASS: Record<PageContainerWidth, string> = {
  narrow: 'view-shell--narrow',
  default: '',
  wide: 'view-shell--wide',
};

/**
 * QNBS-v3: Centers content-light views at a comfortable desktop work-width. The width caps live in
 * the `.is-desktop .view-shell*` rules (index.css) so they only apply inside the Tauri desktop
 * WebView (body.is-desktop) — the PWA stays full-width and byte-equivalent. No-op until D0's
 * `applyDesktopRuntimeFlags()` has tagged the body.
 *
 * Wrap content-light views (Dashboard, Settings, Help, Export, …). Do NOT wrap the manuscript
 * editor, Plot Board, or Mind Map — those own their own width/layout.
 */
export const PageContainer: FC<PageContainerProps> = ({
  children,
  width = 'default',
  className = '',
}) => (
  <div
    className={`view-shell w-full ${WIDTH_CLASS[width]} ${className}`.replace(/\s+/g, ' ').trim()}
  >
    {children}
  </div>
);
