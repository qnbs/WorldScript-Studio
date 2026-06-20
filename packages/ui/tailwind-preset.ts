import type { Config } from 'tailwindcss';

/** Matches `index.css` semantic vars — utilities like `bg-sc-accent`, `rounded-sc-lg`. */
export const worldscriptTailwindPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        // Core semantic tokens
        'sc-bg': 'var(--sc-bg)',
        'sc-fg': 'var(--sc-fg)',
        'sc-muted': 'var(--sc-muted)',
        'sc-accent': 'var(--sc-accent)',
        'sc-accent-hover': 'var(--sc-accent-hover)',
        'sc-accent-subtle': 'var(--sc-accent-subtle)',
        'sc-surface-base': 'var(--sc-surface-base)',
        'sc-surface-raised': 'var(--sc-surface-raised)',
        'sc-surface-overlay': 'var(--sc-surface-overlay)',
        'sc-surface-inverse': 'var(--sc-surface-inverse)',
        'sc-text-primary': 'var(--sc-text-primary)',
        'sc-text-secondary': 'var(--sc-text-secondary)',
        'sc-text-muted': 'var(--sc-text-muted)',
        'sc-text-on-accent': 'var(--sc-text-on-accent)',
        // Status tokens
        'sc-danger-bg': 'var(--sc-danger-bg)',
        'sc-danger-fg': 'var(--sc-danger-fg)',
        'sc-danger-border': 'var(--sc-danger-border)',
        'sc-success-bg': 'var(--sc-success-bg)',
        'sc-success-fg': 'var(--sc-success-fg)',
        'sc-warning-bg': 'var(--sc-warning-bg)',
        'sc-warning-fg': 'var(--sc-warning-fg)',
        'sc-info-bg': 'var(--sc-info-bg)',
        'sc-info-fg': 'var(--sc-info-fg)',
        // Data-viz tokens
        'sc-data-1': 'var(--sc-data-1)',
        'sc-data-2': 'var(--sc-data-2)',
        'sc-data-3': 'var(--sc-data-3)',
        'sc-data-4': 'var(--sc-data-4)',
        'sc-data-5': 'var(--sc-data-5)',
        'sc-data-6': 'var(--sc-data-6)',
        'sc-data-7': 'var(--sc-data-7)',
        'sc-data-8': 'var(--sc-data-8)',
        'sc-heat-0': 'var(--sc-heat-0)',
        'sc-heat-1': 'var(--sc-heat-1)',
        'sc-heat-2': 'var(--sc-heat-2)',
        'sc-heat-3': 'var(--sc-heat-3)',
        'sc-heat-4': 'var(--sc-heat-4)',
        // Border tokens
        'sc-border-subtle': 'var(--sc-border-subtle)',
        'sc-border-strong': 'var(--sc-border-strong)',
        'sc-border-focus': 'var(--sc-border-focus)',
        'sc-ring-focus': 'var(--sc-ring-focus)',
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
      width: {
        'icon-sc-sm': 'var(--icon-sc-sm)',
        'icon-sc-md': 'var(--icon-sc-md)',
        'icon-sc-lg': 'var(--icon-sc-lg)',
        'icon-sc-xl': 'var(--icon-sc-xl)',
      },
      height: {
        'icon-sc-sm': 'var(--icon-sc-sm)',
        'icon-sc-md': 'var(--icon-sc-md)',
        'icon-sc-lg': 'var(--icon-sc-lg)',
        'icon-sc-xl': 'var(--icon-sc-xl)',
      },
      // QNBS-v3 (D3): pointer-aware touch target. `--size-touch-target` is 44px (AAA) by default
      // and shrinks to 36px (still WCAG 2.2 AA — 24px min) only under `.is-desktop` + fine pointer
      // (index.css). Use `min-h-touch`/`min-w-touch` instead of raw `min-h-[44px]`.
      minHeight: {
        touch: 'var(--size-touch-target)',
      },
      minWidth: {
        touch: 'var(--size-touch-target)',
      },
      fontSize: {
        'sc-xs': ['var(--text-sc-xs)', { lineHeight: '1.5' }],
        'sc-sm': ['var(--text-sc-sm)', { lineHeight: '1.5' }],
        'sc-base': ['var(--text-sc-base)', { lineHeight: '1.6' }],
        'sc-lg': ['var(--text-sc-lg)', { lineHeight: '1.5' }],
        'sc-xl': ['var(--text-sc-xl)', { lineHeight: '1.4' }],
        'sc-2xl': ['var(--text-sc-2xl)', { lineHeight: '1.3' }],
        'sc-3xl': ['var(--text-sc-3xl)', { lineHeight: '1.25' }],
        'sc-4xl': ['var(--text-sc-4xl)', { lineHeight: '1.1' }],
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
