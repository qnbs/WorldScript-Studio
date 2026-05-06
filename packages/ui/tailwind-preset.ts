import type { Config } from 'tailwindcss';

export const storycraftTailwindPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        scbg: 'var(--sc-bg)',
        scfg: 'var(--sc-fg)',
        scaccent: 'var(--sc-accent)',
        scmuted: 'var(--sc-muted)',
      },
      borderRadius: {
        scsm: '0.375rem',
        scmd: '0.5rem',
        sclg: '0.75rem',
      },
    },
  },
};
