// QNBS-v3: surfaces which non-default Writer modes are active (Flow/Focus/ProForge/collapsed
// panels) plus a single "restore standard layout" action, so users never get lost wondering why
// a panel is hidden (audit: mode-explosion / context-loss risk). Pure/props-driven.
import type { FC } from 'react';

export interface WriterModeBadgeProps {
  flowMode: boolean;
  focusMode: boolean;
  proForgeActive: boolean;
  contextHidden: boolean;
  toolsHidden: boolean;
  onReset: () => void;
  t: (key: string) => string;
}

type Chip = { key: string; label: string; tone: 'accent' | 'warning' };

const CHIP_TONE: Record<Chip['tone'], string> = {
  accent: 'bg-[var(--sc-accent)]/15 text-[var(--sc-accent)] border border-[var(--sc-accent)]/30',
  warning: 'bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)] border border-transparent',
};

export const WriterModeBadge: FC<WriterModeBadgeProps> = ({
  flowMode,
  focusMode,
  proForgeActive,
  contextHidden,
  toolsHidden,
  onReset,
  t,
}) => {
  const chips: Chip[] = [];
  if (flowMode) chips.push({ key: 'flow', label: t('writer.modeBadge.flow'), tone: 'accent' });
  if (focusMode) chips.push({ key: 'focus', label: t('writer.modeBadge.focus'), tone: 'accent' });
  if (proForgeActive)
    chips.push({ key: 'proforge', label: t('writer.modeBadge.proforge'), tone: 'accent' });
  if (contextHidden)
    chips.push({ key: 'context', label: t('writer.modeBadge.contextHidden'), tone: 'warning' });
  if (toolsHidden)
    chips.push({ key: 'tools', label: t('writer.modeBadge.toolsHidden'), tone: 'warning' });

  if (chips.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 flex-wrap mb-2"
      role="status"
      aria-live="polite"
      aria-label={t('writer.modeBadge.label')}
    >
      <span className="text-xs text-[var(--sc-text-muted)]">{t('writer.modeBadge.label')}</span>
      {chips.map((c) => (
        <span key={c.key} className={`text-xs px-2 py-0.5 rounded-full ${CHIP_TONE[c.tone]}`}>
          {c.label}
        </span>
      ))}
      <button
        type="button"
        onClick={onReset}
        title={t('writer.modeBadge.resetTitle')}
        className="text-xs min-h-[44px] sm:min-h-0 px-2 py-1 rounded border border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] transition-colors"
      >
        <span aria-hidden="true">↺ </span>
        {t('writer.modeBadge.reset')}
      </button>
    </div>
  );
};
WriterModeBadge.displayName = 'WriterModeBadge';
