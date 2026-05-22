import { useCallback, useEffect, useState } from 'react';
import { useMindMapViewContext } from '../../contexts/MindMapViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import type { MindMapLinkedEntityType, MindMapNodeShape, MindMapNodeType } from '../../types';

const SHAPES: MindMapNodeShape[] = ['circle', 'rectangle', 'diamond', 'ellipse', 'hexagon'];
const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
const LINKED_TYPES: MindMapLinkedEntityType[] = ['character', 'world', 'object', 'group', 'scene'];

const SHAPE_KEY: Record<MindMapNodeShape, string> = {
  circle: 'mindmap.nodeShapeCircle',
  rectangle: 'mindmap.nodeShapeRectangle',
  diamond: 'mindmap.nodeShapeDiamond',
  ellipse: 'mindmap.nodeShapeEllipse',
  hexagon: 'mindmap.nodeShapeHexagon',
};

// QNBS-v3: All dark: stone/indigo/red Tailwind prefixes replaced with --sc-* tokens — appearance presets now work.
export function MindMapNodeEditor() {
  const { t } = useTranslation();
  const {
    activeMindMap,
    selectedNodeId,
    isNodeEditorOpen,
    handleCloseNodeEditor,
    handleUpdateNode,
    handleDeleteNode,
  } = useMindMapViewContext();

  const node = activeMindMap?.nodes.find((n) => n.id === selectedNodeId);

  const [label, setLabel] = useState('');
  const [textNotes, setTextNotes] = useState('');
  const [type, setType] = useState<MindMapNodeType>('free');
  const [shape, setShape] = useState<MindMapNodeShape>('rectangle');
  const [color, setColor] = useState('#6366f1');
  const [linkedEntityType, setLinkedEntityType] = useState<MindMapLinkedEntityType | ''>('');

  useEffect(() => {
    if (node) {
      setLabel(node.label);
      setTextNotes(node.textNotes);
      setType(node.type);
      setShape(node.shape);
      setColor(node.color);
      setLinkedEntityType(node.linkedEntityType ?? '');
    }
  }, [node]);

  const handleSave = useCallback(() => {
    if (!node) return;
    const resolvedEntityType =
      type === 'linked' && linkedEntityType
        ? (linkedEntityType as MindMapLinkedEntityType)
        : undefined;
    handleUpdateNode(node.id, {
      label,
      textNotes,
      type,
      shape,
      color,
      // QNBS-v3: exactOptionalPropertyTypes — conditional spread avoids assigning undefined to optional prop
      ...(resolvedEntityType !== undefined ? { linkedEntityType: resolvedEntityType } : {}),
    });
    handleCloseNodeEditor();
  }, [
    node,
    label,
    textNotes,
    type,
    shape,
    color,
    linkedEntityType,
    handleUpdateNode,
    handleCloseNodeEditor,
  ]);

  const handleDelete = useCallback(() => {
    if (!node) return;
    handleDeleteNode(node.id);
    handleCloseNodeEditor();
  }, [node, handleDeleteNode, handleCloseNodeEditor]);

  if (!isNodeEditorOpen || !node) return null;

  const inputClass =
    'w-full text-sm px-2 py-1.5 rounded-sc-sm border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] outline-none placeholder:text-[var(--sc-text-muted)]';

  return (
    <aside
      className="w-72 flex-shrink-0 border-l border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] flex flex-col overflow-y-auto"
      aria-label={t('mindmap.editNode')}
    >
      <div className="flex items-center justify-between p-3 border-b border-[var(--sc-border-subtle)]">
        <h3 className="text-sm font-semibold text-[var(--sc-text-primary)]">
          {t('mindmap.editNode')}
        </h3>
        <button
          type="button"
          onClick={handleCloseNodeEditor}
          aria-label={t('mindmap.cancel')}
          className="p-1 rounded-sc-sm hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-muted)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 p-3 space-y-4">
        <div>
          <label
            htmlFor="mm-node-label"
            className="block text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
          >
            {t('mindmap.nodeLabel')}
          </label>
          <input
            id="mm-node-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('mindmap.nodeLabelPlaceholder')}
            className={inputClass}
          />
        </div>

        <div>
          <label
            htmlFor="mm-node-type"
            className="block text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
          >
            {t('mindmap.nodeType')}
          </label>
          <select
            id="mm-node-type"
            value={type}
            onChange={(e) => setType(e.target.value as MindMapNodeType)}
            className={inputClass}
          >
            <option value="free">{t('mindmap.nodeTypeFree')}</option>
            <option value="linked">{t('mindmap.nodeTypeLinked')}</option>
          </select>
        </div>

        {type === 'linked' && (
          <div>
            <label
              htmlFor="mm-node-entity-type"
              className="block text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
            >
              {t('mindmap.linkedEntityType')}
            </label>
            <select
              id="mm-node-entity-type"
              value={linkedEntityType}
              onChange={(e) => setLinkedEntityType(e.target.value as MindMapLinkedEntityType)}
              className={inputClass}
            >
              <option value="">{t('mindmap.linkedEntityTypePlaceholder')}</option>
              {LINKED_TYPES.map((lt) => (
                <option key={lt} value={lt}>
                  {lt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          {/* QNBS-v3: no single input for shape group, so use <p> instead of <label> for a11y */}
          <p
            className="text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
            aria-hidden="true"
          >
            {t('mindmap.nodeShape')}
          </p>
          <div className="flex gap-2 flex-wrap" role="group" aria-label={t('mindmap.nodeShape')}>
            {SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setShape(s)}
                aria-pressed={shape === s}
                className={`px-2 py-1 text-xs rounded-sc-sm border capitalize ${
                  shape === s
                    ? 'bg-[var(--sc-accent)]/15 border-[var(--sc-accent)] text-[var(--sc-accent)]'
                    : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)]'
                }`}
              >
                {t(SHAPE_KEY[s] as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>

        <div>
          {/* QNBS-v3: colour swatches have no single associated input, use <p> for a11y */}
          <p
            className="text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
            aria-hidden="true"
          >
            {t('mindmap.nodeColor')}
          </p>
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label={t('mindmap.nodeColor')}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-pressed={color === c}
                aria-label={c}
                style={{ background: c }}
                className={`w-6 h-6 rounded-full border-2 ${
                  color === c ? 'border-[var(--sc-text-primary)]' : 'border-transparent'
                }`}
              />
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="mm-node-notes"
            className="block text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
          >
            {t('mindmap.nodeNotes')}
          </label>
          <textarea
            id="mm-node-notes"
            value={textNotes}
            onChange={(e) => setTextNotes(e.target.value)}
            placeholder={t('mindmap.nodeNotesPlaceholder')}
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </div>
      </div>

      <div className="p-3 border-t border-[var(--sc-border-subtle)] flex justify-between">
        <button
          type="button"
          onClick={handleDelete}
          className="text-xs px-3 py-1.5 rounded-sc-sm bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)] hover:opacity-80"
        >
          {t('mindmap.deleteNode')}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCloseNodeEditor}
            className="text-xs px-3 py-1.5 rounded-sc-sm border border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)]"
          >
            {t('mindmap.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="text-xs px-3 py-1.5 rounded-sc-sm bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-white"
          >
            {t('mindmap.save')}
          </button>
        </div>
      </div>
    </aside>
  );
}
