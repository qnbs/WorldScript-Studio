import type { FC, ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  /** Extra classes merged onto the shell (e.g. spacing overrides). */
  className?: string;
}

/**
 * QNBS-v3: Centers content-light views at a comfortable desktop work-width. The width cap lives in
 * the `.is-desktop .view-shell` rule (index.css) so it only applies inside the Tauri desktop
 * WebView (body.is-desktop) — the PWA stays full-width and byte-equivalent. No-op until D0's
 * `applyDesktopRuntimeFlags()` has tagged the body.
 *
 * Wrap content-light views (Dashboard, Settings, Help, Export, …). Do NOT wrap the manuscript
 * editor, Plot Board, or Mind Map — those own their own width/layout.
 */
export const PageContainer: FC<PageContainerProps> = ({ children, className = '' }) => (
  <div className={`view-shell w-full ${className}`.trim()}>{children}</div>
);
