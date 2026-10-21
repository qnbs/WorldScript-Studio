import type { FC } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useTranslation } from '../../hooks/useTranslation';

interface EditorStatsBadgeProps {
  wordCount: number;
  readTime: number;
}

/** Word count and reading-time badge; each part follows its Settings → Advanced Editor toggle (#818). */
export const EditorStatsBadge: FC<EditorStatsBadgeProps> = ({ wordCount, readTime }) => {
  const { t } = useTranslation();
  const editor = useAppSelector((state) => state.settings.advancedEditor);
  const parts: string[] = [];
  if (editor?.wordCount ?? true) parts.push(`${wordCount} ${t('common.words')}`);
  if (editor?.readingTime ?? true) {
    parts.push(t('manuscript.inspector.readTimeValue', { time: String(readTime) }));
  }
  if (parts.length === 0) return null;
  return (
    <div className="absolute bottom-20 left-6 md:bottom-4 text-xs text-[var(--sc-text-muted)] bg-[var(--sc-surface-raised)]/90 border border-[var(--sc-border-subtle)] px-3 py-1 rounded-full pointer-events-none backdrop-blur-sm shadow-sm transition-opacity duration-300">
      {parts.join(' · ')}
    </div>
  );
};
