/**
 * WorldScript semantic design tokens — mirror `index.css` CSS custom properties.
 * QNBS-v3: Single TS source for Storybook/docs; runtime styling uses CSS vars.
 */
export const designTokens = {
  color: {
    bg: 'var(--sc-bg)',
    fg: 'var(--sc-fg)',
    muted: 'var(--sc-muted)',
    accent: 'var(--sc-accent)',
    surfaceBase: 'var(--sc-surface-base)',
    surfaceRaised: 'var(--sc-surface-raised)',
    surfaceOverlay: 'var(--sc-surface-overlay)',
    surfaceInverse: 'var(--sc-surface-inverse)',
    textPrimary: 'var(--sc-text-primary)',
    textSecondary: 'var(--sc-text-secondary)',
    textMuted: 'var(--sc-text-muted)',
    textOnAccent: 'var(--sc-text-on-accent)',
    accentHover: 'var(--sc-accent-hover)',
    accentSubtle: 'var(--sc-accent-subtle)',
    borderSubtle: 'var(--sc-border-subtle)',
    borderStrong: 'var(--sc-border-strong)',
    borderFocus: 'var(--sc-border-focus)',
    ringFocus: 'var(--sc-ring-focus)',
    dangerBg: 'var(--sc-danger-bg)',
    dangerFg: 'var(--sc-danger-fg)',
    dangerBorder: 'var(--sc-danger-border)',
    successBg: 'var(--sc-success-bg)',
    successFg: 'var(--sc-success-fg)',
    warningBg: 'var(--sc-warning-bg)',
    warningFg: 'var(--sc-warning-fg)',
    infoBg: 'var(--sc-info-bg)',
    infoFg: 'var(--sc-info-fg)',
    proseBg: 'var(--sc-prose-bg)',
    proseFg: 'var(--sc-prose-fg)',
  },
  shadow: {
    xs: 'var(--sc-shadow-xs)',
    sm: 'var(--sc-shadow-sm)',
    md: 'var(--sc-shadow-md)',
    lg: 'var(--sc-shadow-lg)',
    xl: 'var(--sc-shadow-xl)',
    accentGlow: 'var(--sc-accent-glow)',
  },
  radius: {
    sm: 'var(--radius-sc-sm)',
    md: 'var(--radius-sc-md)',
    lg: 'var(--radius-sc-lg)',
  },
  spacing: {
    xs: 'var(--spacing-sc-xs)',
    sm: 'var(--spacing-sc-sm)',
    md: 'var(--spacing-sc-md)',
    lg: 'var(--spacing-sc-lg)',
    xl: 'var(--spacing-sc-xl)',
  },
  typography: {
    fontUi: 'var(--font-ui)',
    fontEditor: 'var(--font-editor)',
    fontMono: 'var(--font-mono)',
    proseMeasure: 'var(--sc-prose-measure)',
  },
  motion: {
    durationFast: 'var(--sc-duration-fast)',
    durationNormal: 'var(--sc-duration-normal)',
    easeStandard: 'var(--sc-ease-standard)',
    easeEmphasized: 'var(--sc-ease-emphasized)',
  },
  zIndex: {
    docked: 'var(--sc-z-docked)',
    sticky: 'var(--sc-z-sticky)',
    command: 'var(--sc-z-command)',
    modal: 'var(--sc-z-modal)',
    toast: 'var(--sc-z-toast)',
  },
} as const;

export type DesignTokens = typeof designTokens;
