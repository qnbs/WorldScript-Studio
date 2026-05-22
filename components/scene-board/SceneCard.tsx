import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FC } from 'react';
import React, { useState } from 'react';
import type { Character, StorySection } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';

const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280',
  outline: '#f59e0b',
  'first-draft': '#3b82f6',
  revised: '#8b5cf6',
  final: '#10b981',
};

interface SceneCardProps {
  section: StorySection;
  characters: Character[];
  locationOptions: { id: string; label: string }[];
  t: (key: string, replacements?: Record<string, string>) => string;
  onUpdate: (id: string, updates: Partial<StorySection>) => void;
  onDelete: (id: string) => void;
  sceneIndexInAct: number;
  actLaneLength: number;
  onReorderInAct: (id: string, direction: 'up' | 'down') => void;
}

export const SceneCard: FC<SceneCardProps> = React.memo(
  ({
    section,
    characters,
    locationOptions,
    t,
    onUpdate,
    onDelete,
    sceneIndexInAct,
    actLaneLength,
    onReorderInAct,
  }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: section.id,
    });
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({
      title: section.title,
      summary: section.summary || '',
      color: section.color || '#3b82f6',
      status: section.status || 'draft',
      act: section.act || 1,
      sceneStart: section.sceneStart ?? '',
      sceneDuration: section.sceneDuration ?? '',
      sceneLocationId: section.sceneLocationId ?? '',
      povCharacterId: section.povCharacterId ?? '',
    });

    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
    };

    const handleSave = () => {
      const changes: Partial<StorySection> = {
        title: editData.title,
        summary: editData.summary,
        color: editData.color,
        status: editData.status,
        act: editData.act,
      };
      const ss = editData.sceneStart.trim();
      const sd = editData.sceneDuration.trim();
      const sl = editData.sceneLocationId.trim();
      const pv = editData.povCharacterId.trim();
      if (ss) changes.sceneStart = ss;
      if (sd) changes.sceneDuration = sd;
      if (sl) changes.sceneLocationId = sl;
      if (pv) changes.povCharacterId = pv;
      onUpdate(section.id, changes);
      setIsEditing(false);
    };

    const linkedChars = (characters || []).filter((c) => section.characterIds?.includes(c.id));
    const statusColor = STATUS_COLORS[section.status || 'draft'] || '#6b7280';

    return (
      <div
        ref={setNodeRef}
        style={style}
        className="bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] rounded-sc-lg p-3 mb-2 shadow-sc-sm cursor-grab active:cursor-grabbing hover:shadow-sc-md transition-[box-shadow] duration-sc-normal ease-sc-standard"
        {...attributes}
        {...listeners}
      >
        {isEditing ? (
          <div
            role="group"
            className="space-y-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Input
              value={editData.title}
              onChange={(e) => setEditData((p) => ({ ...p, title: e.target.value }))}
              className="text-sm font-semibold"
            />
            <Textarea
              value={editData.summary}
              onChange={(e) => setEditData((p) => ({ ...p, summary: e.target.value }))}
              placeholder={t('sceneboard.summary.placeholder')}
              className="text-xs h-16 resize-none"
            />
            <div className="flex items-center gap-2">
              <Select
                value={editData.status}
                onChange={(e) =>
                  setEditData((p) => ({
                    ...p,
                    status: e.target.value as
                      | 'outline'
                      | 'draft'
                      | 'first-draft'
                      | 'revised'
                      | 'final',
                  }))
                }
                className="text-xs"
              >
                <option value="draft">{t('sceneboard.status.draft')}</option>
                <option value="outline">{t('sceneboard.status.outline')}</option>
                <option value="first-draft">{t('sceneboard.status.firstDraft')}</option>
                <option value="revised">{t('sceneboard.status.revised')}</option>
                <option value="final">{t('sceneboard.status.final')}</option>
              </Select>
              <Select
                value={editData.act}
                onChange={(e) =>
                  setEditData((p) => ({
                    ...p,
                    act: parseInt(e.target.value, 10) as 1 | 2 | 3,
                  }))
                }
                className="text-xs"
              >
                <option value={1}>{t('sceneboard.act1')}</option>
                <option value={2}>{t('sceneboard.act2')}</option>
                <option value={3}>{t('sceneboard.act3')}</option>
              </Select>
              <input
                type="color"
                value={editData.color}
                onChange={(e) => setEditData((p) => ({ ...p, color: e.target.value }))}
                className="w-7 h-7 rounded border cursor-pointer"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 border-t border-[var(--sc-border-subtle)] pt-2 mt-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sc-text-muted)]">
                {t('sceneboard.timeline.metaHeading')}
              </p>
              <Input
                value={editData.sceneStart}
                onChange={(e) => setEditData((p) => ({ ...p, sceneStart: e.target.value }))}
                placeholder={t('sceneboard.timeline.sceneStartPlaceholder')}
                className="text-xs"
                aria-label={t('sceneboard.timeline.sceneStartPlaceholder')}
              />
              <Input
                value={editData.sceneDuration}
                onChange={(e) => setEditData((p) => ({ ...p, sceneDuration: e.target.value }))}
                placeholder={t('sceneboard.timeline.sceneDurationPlaceholder')}
                className="text-xs"
                aria-label={t('sceneboard.timeline.sceneDurationPlaceholder')}
              />
              <Select
                value={editData.sceneLocationId || ''}
                onChange={(e) => setEditData((p) => ({ ...p, sceneLocationId: e.target.value }))}
                className="text-xs"
                aria-label={t('sceneboard.timeline.locationLabel')}
              >
                <option value="">{t('sceneboard.timeline.locationNone')}</option>
                {locationOptions.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.label}
                  </option>
                ))}
              </Select>
              <Select
                value={editData.povCharacterId || ''}
                onChange={(e) => setEditData((p) => ({ ...p, povCharacterId: e.target.value }))}
                className="text-xs"
                aria-label={t('sceneboard.timeline.povLabel')}
              >
                <option value="">{t('sceneboard.timeline.povNone')}</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-between">
              <Button size="sm" variant="danger" onClick={() => onDelete(section.id)}>
                {t('common.delete')}
              </Button>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" onClick={handleSave}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: section.color || '#3b82f6' }}
                />
                <h4 className="text-sm font-semibold text-[var(--sc-text-primary)] line-clamp-1">
                  {section.title}
                </h4>
              </div>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditData({
                    title: section.title,
                    summary: section.summary || '',
                    color: section.color || '#3b82f6',
                    status: section.status || 'draft',
                    act: section.act || 1,
                    sceneStart: section.sceneStart ?? '',
                    sceneDuration: section.sceneDuration ?? '',
                    sceneLocationId: section.sceneLocationId ?? '',
                    povCharacterId: section.povCharacterId ?? '',
                  });
                  setIsEditing(true);
                }}
                className="text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] p-0.5 rounded"
                aria-label={t('sceneboard.editScene', { title: section.title })}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                  />
                </svg>
              </button>
            </div>
            {section.summary && (
              <p className="text-xs text-[var(--sc-text-muted)] line-clamp-2 mb-2">
                {section.summary}
              </p>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: statusColor }}
                />
                <span className="text-xs text-[var(--sc-text-muted)] capitalize">
                  {section.status || 'draft'}
                </span>
              </div>
              <span className="text-xs text-[var(--sc-text-muted)]">
                {section.wordCount || 0} W.
              </span>
            </div>
            {linkedChars.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {linkedChars.slice(0, 3).map((c) => (
                  <span
                    key={c.id}
                    className="text-xs bg-indigo-500/15 text-indigo-400 px-1.5 py-0.5 rounded"
                  >
                    @{c.name}
                  </span>
                ))}
                {linkedChars.length > 3 && (
                  <span className="text-xs text-[var(--sc-text-muted)]">
                    +{linkedChars.length - 3}
                  </span>
                )}
              </div>
            )}
            {/* QNBS-v3: Keyboard-accessible reorder alternative to drag (WCAG 2.2 AA). */}
            <div
              className="flex justify-end gap-1 mt-2 pt-2 border-t border-[var(--sc-border-subtle)]/60"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="px-2 py-1 h-8 min-h-0"
                disabled={sceneIndexInAct <= 0}
                aria-label={t('common.moveUp')}
                onClick={(e) => {
                  e.stopPropagation();
                  onReorderInAct(section.id, 'up');
                }}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="px-2 py-1 h-8 min-h-0"
                disabled={sceneIndexInAct >= actLaneLength - 1}
                aria-label={t('common.moveDown')}
                onClick={(e) => {
                  e.stopPropagation();
                  onReorderInAct(section.id, 'down');
                }}
              >
                ↓
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
SceneCard.displayName = 'SceneCard';
