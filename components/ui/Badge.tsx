import type { FC, ReactNode } from 'react';
import React from 'react';

export type BadgeVariant = 'experimental' | 'beta' | 'new' | 'neutral';

interface BadgeProps {
  /** Visual tone. `experimental` = warning/amber, `beta` = info/blue, `new` = success/green. */
  variant?: BadgeVariant;
  /** Visible text. Defaults to the capitalized variant name when omitted (except `neutral`). */
  children?: ReactNode;
  className?: string;
  /**
   * Accessible label. When the badge is decorative next to already-labelled content (e.g. a feature
   * toggle), pass an empty string to hide it from the a11y tree via aria-hidden; otherwise the text
   * content is announced. QNBS-v3: keeps screen-reader output from doubling up "Experimental".
   */
  srLabel?: string;
}

// QNBS-v3: variant → semantic state tokens (never hardcoded colors — they break on dark/sepia themes).
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  experimental: 'bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]',
  beta: 'bg-[var(--sc-info-bg)] text-[var(--sc-info-fg)]',
  new: 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]',
  neutral: 'bg-[var(--sc-surface-overlay)]/50 text-[var(--sc-text-muted)]',
};

const DEFAULT_TEXT: Record<BadgeVariant, string> = {
  experimental: 'Experimental',
  beta: 'Beta',
  new: 'New',
  neutral: '',
};

/**
 * Small inline status pill for labelling features as Experimental / Beta / New.
 * Pure rendering, theme-token driven. Reused by FeatureFlagsSection, the ProForge header, and the
 * Ollama "recommended for your device" chip.
 */
export const Badge: FC<BadgeProps> = React.memo(
  ({ variant = 'neutral', children, className, srLabel }) => {
    const content = children ?? DEFAULT_TEXT[variant];
    // When srLabel is an empty string, the badge is decorative — hide from a11y tree.
    const decorative = srLabel === '';
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-sc-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none ${VARIANT_CLASS[variant]} ${className ?? ''}`}
        {...(decorative
          ? { 'aria-hidden': true }
          : srLabel
            ? { role: 'note', 'aria-label': srLabel }
            : {})}
      >
        {content}
      </span>
    );
  },
);
Badge.displayName = 'Badge';
