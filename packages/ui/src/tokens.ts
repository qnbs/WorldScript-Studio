export const designTokens = {
  color: {
    bg: 'var(--sc-bg)',
    fg: 'var(--sc-fg)',
    accent: 'var(--sc-accent)',
    muted: 'var(--sc-muted)',
  },
  radius: {
    sm: '0.375rem',
    md: '0.5rem',
    lg: '0.75rem',
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  },
} as const;

export type DesignTokens = typeof designTokens;
