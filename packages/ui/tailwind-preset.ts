import type { Config } from 'tailwindcss';

/** Matches `index.css` semantic vars — utilities like `bg-sc-accent`, `rounded-sc-lg`. */
export const storycraftTailwindPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        'sc-bg': 'var(--sc-bg)',
        'sc-fg': 'var(--sc-fg)',
        'sc-muted': 'var(--sc-muted)',
        'sc-accent': 'var(--sc-accent)',
        'sc-surface-base': 'var(--sc-surface-base)',
        'sc-surface-raised': 'var(--sc-surface-raised)',
        'sc-surface-overlay': 'var(--sc-surface-overlay)',
        'sc-text-primary': 'var(--sc-text-primary)',
        'sc-text-secondary': 'var(--sc-text-secondary)',
        'sc-text-muted': 'var(--sc-text-muted)',
      },
      borderRadius: {
        'sc-sm': 'var(--radius-sc-sm)',
        'sc-md': 'var(--radius-sc-md)',
        'sc-lg': 'var(--radius-sc-lg)',
        'sc-xl': 'var(--radius-sc-xl)',
      },
      spacing: {
        'sc-xs': 'var(--spacing-sc-xs)',
        'sc-sm': 'var(--spacing-sc-sm)',
        'sc-md': 'var(--spacing-sc-md)',
        'sc-lg': 'var(--spacing-sc-lg)',
        'sc-xl': 'var(--spacing-sc-xl)',
      },
      boxShadow: {
        'sc-sm': 'var(--sc-shadow-sm)',
        'sc-md': 'var(--sc-shadow-md)',
        'sc-lg': 'var(--sc-shadow-lg)',
      },
      fontFamily: {
        'sc-ui': ['var(--font-ui)'],
        'sc-editor': ['var(--font-editor)'],
        'sc-mono': ['var(--font-mono)'],
      },
      transitionDuration: {
        'sc-fast': 'var(--sc-duration-fast)',
        'sc-normal': 'var(--sc-duration-normal)',
      },
      transitionTimingFunction: {
        'sc-standard': 'var(--sc-ease-standard)',
        'sc-emphasized': 'var(--sc-ease-emphasized)',
      },
      zIndex: {
        'sc-docked': '10',
        'sc-sticky': '100',
        'sc-command': '150',
        'sc-modal': '200',
        'sc-toast': '300',
      },
    },
  },
};
