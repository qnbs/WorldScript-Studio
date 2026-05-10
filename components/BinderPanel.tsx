import type { FC } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectProjectData } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { useTranslation } from '../hooks/useTranslation';
import type { BinderNode } from '../types';
import { Button } from './ui/Button';

function sortBinderNodes(nodes: BinderNode[]): BinderNode[] {
  return [...nodes].sort((a, b) => {
    const pa = a.parentId ?? '';
    const pb = b.parentId ?? '';
    if (pa !== pb) return pa.localeCompare(pb);
    return a.sortIndex - b.sortIndex || a.title.localeCompare(b.title);
  });
}

function binderDepth(node: BinderNode, byId: Map<string, BinderNode>): number {
  if (!node.parentId) return 0;
  let d = 0;
  let pid: string | null = node.parentId;
  while (pid) {
    d++;
    const p = byId.get(pid);
    pid = p?.parentId ?? null;
  }
  return d;
}

export const BinderPanel: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const nodes = project?.binderNodes ?? [];
  const sorted = useMemo(() => sortBinderNodes(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sorted.find((n) => n.id === selectedId);

  const researchRootId = useMemo(() => {
    const existing = nodes.find((n) => n.type === 'folder' && n.title === 'Research');
    return existing?.id ?? null;
  }, [nodes]);

  const ensureResearchRoot = useCallback(() => {
    if (researchRootId) return researchRootId;
    const id = uuidv4();
    const root: BinderNode = {
      id,
      parentId: null,
      type: 'folder',
      title: 'Research',
      sortIndex: 0,
    };
    dispatch(projectActions.addBinderNode(root));
    return id;
  }, [dispatch, researchRootId]);

  const handleAddFolder = () => {
    const parent = ensureResearchRoot();
    const maxSort = nodes
      .filter((n) => n.parentId === parent)
      .reduce((m, n) => Math.max(m, n.sortIndex), -1);
    dispatch(
      projectActions.addBinderNode({
        id: uuidv4(),
        parentId: parent,
        type: 'folder',
        title: t('manuscript.binder.newFolder'),
        sortIndex: maxSort + 1,
      }),
    );
  };

  const handleAddNote = () => {
    const parent = ensureResearchRoot();
    const maxSort = nodes
      .filter((n) => n.parentId === parent)
      .reduce((m, n) => Math.max(m, n.sortIndex), -1);
    const id = uuidv4();
    dispatch(
      projectActions.addBinderNode({
        id,
        parentId: parent,
        type: 'note',
        title: t('manuscript.binder.newNote'),
        content: '',
        sortIndex: maxSort + 1,
      }),
    );
    setSelectedId(id);
  };

  const updateSelectedContent = (content: string) => {
    if (!selectedId) return;
    dispatch(projectActions.updateBinderNode({ id: selectedId, changes: { content } }));
  };

  const updateSelectedTitle = (title: string) => {
    if (!selectedId) return;
    dispatch(projectActions.updateBinderNode({ id: selectedId, changes: { title } }));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-2 border-b border-[var(--border-primary)] flex-wrap">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="flex-1 min-w-[100px]"
          onClick={handleAddFolder}
        >
          {t('manuscript.binder.addFolder')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="flex-1 min-w-[100px]"
          onClick={handleAddNote}
        >
          {t('manuscript.binder.addNote')}
        </Button>
      </div>
      <div className="flex-grow overflow-y-auto p-2 space-y-1">
        {sorted.length === 0 ? (
          <p className="text-xs text-[var(--foreground-muted)] px-1">
            {t('manuscript.binder.empty')}
          </p>
        ) : (
          sorted.map((n) => {
            const depth = binderDepth(n, byId);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                className={`w-full text-left rounded px-2 py-1.5 text-sm transition-colors ${
                  selectedId === n.id
                    ? 'bg-[var(--background-interactive)]/20 text-[var(--foreground-primary)]'
                    : 'hover:bg-[var(--background-tertiary)] text-[var(--foreground-secondary)]'
                }`}
                style={{ paddingLeft: `${8 + depth * 12}px` }}
              >
                <span className="mr-1 opacity-60" aria-hidden="true">
                  {n.type === 'folder' ? '📁' : '📝'}
                </span>
                {n.title}
              </button>
            );
          })
        )}
      </div>
      {selected && (selected.type === 'note' || selected.type === 'text') ? (
        <div className="p-2 border-t border-[var(--border-primary)] space-y-2 flex-shrink-0">
          <label htmlFor="binder-note-title" className="sr-only">
            {t('manuscript.binder.noteTitle')}
          </label>
          <input
            id="binder-note-title"
            value={selected.title}
            onChange={(e) => updateSelectedTitle(e.target.value)}
            className="w-full px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--input-background)] text-sm"
          />
          <label htmlFor="binder-note-body" className="sr-only">
            {t('manuscript.binder.noteBody')}
          </label>
          <textarea
            id="binder-note-body"
            value={selected.content ?? ''}
            onChange={(e) => updateSelectedContent(e.target.value)}
            rows={6}
            className="w-full px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--input-background)] text-sm resize-y"
            placeholder={t('manuscript.binder.notePlaceholder')}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-400 w-full"
            onClick={() => {
              dispatch(projectActions.deleteBinderNode(selected.id));
              setSelectedId(null);
            }}
          >
            {t('manuscript.binder.deleteNode')}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
