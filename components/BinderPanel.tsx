import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import { selectProjectData } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import {
  importBinderFileThunk,
  removeBinderSubtreeWithAssetsThunk,
} from '../features/project/thunks/binderThunks';
import { statusActions } from '../features/status/statusSlice';
import { useTranslation } from '../hooks/useTranslation';
import { storageService } from '../services/storageService';
import type { BinderNode } from '../types';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';

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

function projectStorageId(data: { id?: string } | undefined): string {
  return data?.id && data.id.length > 0 ? data.id : 'browser-project';
}

function binderTypeIcon(type: BinderNode['type']): string {
  switch (type) {
    case 'folder':
      return '📁';
    case 'pdf':
      return '📄';
    case 'image':
      return '🖼';
    case 'link':
      return '🔗';
    default:
      // note, text, unknown → gleiches Icon (kein redundantes case vor default).
      return '📝';
  }
}

const BinderAssetPreview: FC<{
  projectId: string;
  node: BinderNode;
  t: (key: string) => string;
}> = ({ projectId, node, t }) => {
  const assetId = node.binderAssetId;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assetId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    void (async () => {
      try {
        const payload = await storageService.getBinderAsset(projectId, assetId);
        if (cancelled || !payload) return;
        const blob = new Blob([payload.data], {
          type: payload.meta.mimeType || 'application/octet-stream',
        });
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) setUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // QNBS-v3: MIME aus Payload — kein node.mimeType in deps (vermeidet unnötige Re-Fetches).
  }, [projectId, assetId]);

  if (loading) {
    return (
      <p className="text-xs text-[var(--sc-text-muted)] py-2">
        {t('manuscript.binder.previewLoading')}
      </p>
    );
  }
  if (!url) {
    return (
      <p className="text-xs text-[var(--sc-text-muted)] py-2">
        {t('manuscript.binder.previewUnavailable')}
      </p>
    );
  }
  if (node.type === 'image' || (node.mimeType?.startsWith('image/') ?? false)) {
    return (
      <img
        src={url}
        alt={node.title}
        className="max-h-48 w-full object-contain rounded border border-[var(--sc-border-subtle)] bg-black/10"
      />
    );
  }
  if (node.type === 'pdf' || node.mimeType === 'application/pdf') {
    return (
      <iframe
        title={node.title}
        src={url}
        className="w-full h-48 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]"
      />
    );
  }
  return (
    <p className="text-xs text-[var(--sc-text-muted)]">{node.originalFileName ?? node.title}</p>
  );
};

export const BinderPanel: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const nodes = project?.binderNodes ?? [];
  const sorted = useMemo(() => sortBinderNodes(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sorted.find((n) => n.id === selectedId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkUrlDraft, setLinkUrlDraft] = useState('');
  const [linkTitleDraft, setLinkTitleDraft] = useState('');
  const setPinned = useTransientUiStore((s) => s.setManuscriptPinnedBinderNodeId);
  const setSplitOpen = useTransientUiStore((s) => s.setManuscriptResearchSplitOpen);

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

  const pid = projectStorageId(project);

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

  const handlePickImport = () => fileInputRef.current?.click();

  const onImportFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const parent = ensureResearchRoot();
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (!file) continue;
      try {
        const newId = await dispatch(importBinderFileThunk({ parentId: parent, file })).unwrap();
        setSelectedId(newId);
      } catch (err) {
        dispatch(
          statusActions.addNotification({
            type: 'error',
            title: t('manuscript.binder.importFailed'),
            description: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddLink = () => {
    const url = linkUrlDraft.trim();
    if (!url) return;
    const parent = ensureResearchRoot();
    const maxSort = nodes
      .filter((n) => n.parentId === parent)
      .reduce((m, n) => Math.max(m, n.sortIndex), -1);
    const title =
      linkTitleDraft.trim() ||
      url.replace(/^https?:\/\//i, '').slice(0, 80) ||
      t('manuscript.binder.newLink');
    dispatch(
      projectActions.addBinderNode({
        id: uuidv4(),
        parentId: parent,
        type: 'link',
        title,
        linkUrl: url,
        sortIndex: maxSort + 1,
      }),
    );
    setLinkUrlDraft('');
    setLinkTitleDraft('');
  };

  const updateSelectedContent = (content: string) => {
    if (!selectedId) return;
    dispatch(projectActions.updateBinderNode({ id: selectedId, changes: { content } }));
  };

  const updateSelectedTitle = (title: string) => {
    if (!selectedId) return;
    dispatch(projectActions.updateBinderNode({ id: selectedId, changes: { title } }));
  };

  const handleDeleteSelected = () => {
    if (!selected) return;
    void dispatch(removeBinderSubtreeWithAssetsThunk(selected.id));
    setSelectedId(null);
    setPinned(null);
    setSplitOpen(false);
  };

  const pinForSplit = () => {
    if (!selected) return;
    setPinned(selected.id);
    setSplitOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        accept=".pdf,image/*,.txt,.md"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void onImportFiles(e.target.files)}
      />
      <div className="flex gap-1 p-2 border-b border-[var(--sc-border-subtle)] flex-wrap">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="flex-1 min-w-[88px]"
          onClick={handleAddFolder}
        >
          {t('manuscript.binder.addFolder')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="flex-1 min-w-[88px]"
          onClick={handleAddNote}
        >
          {t('manuscript.binder.addNote')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="flex-1 min-w-[88px]"
          onClick={handlePickImport}
        >
          {t('manuscript.binder.importFile')}
        </Button>
      </div>
      <div className="px-2 py-1 border-b border-[var(--sc-border-subtle)] space-y-1">
        <p className="text-[10px] text-[var(--sc-text-muted)] leading-snug">
          {t('manuscript.binder.assetsLocalHint')}
        </p>
        <label htmlFor="binder-link-url" className="sr-only">
          {t('manuscript.binder.linkUrl')}
        </label>
        <input
          id="binder-link-url"
          value={linkUrlDraft}
          onChange={(e) => setLinkUrlDraft(e.target.value)}
          placeholder={t('manuscript.binder.linkUrl')}
          className="w-full px-2 py-1 rounded border border-[var(--sc-border-subtle)] bg-[var(--input-background)] text-xs"
        />
        <label htmlFor="binder-link-title" className="sr-only">
          {t('manuscript.binder.linkTitleOptional')}
        </label>
        <input
          id="binder-link-title"
          value={linkTitleDraft}
          onChange={(e) => setLinkTitleDraft(e.target.value)}
          placeholder={t('manuscript.binder.linkTitleOptional')}
          className="w-full px-2 py-1 rounded border border-[var(--sc-border-subtle)] bg-[var(--input-background)] text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full text-xs"
          onClick={handleAddLink}
        >
          {t('manuscript.binder.addLink')}
        </Button>
      </div>
      <div className="flex-grow overflow-y-auto p-2 space-y-1">
        {sorted.length === 0 ? (
          <EmptyState
            compact
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-7 h-7"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25m19.5 0A2.25 2.25 0 0 1 19.5 16.5h-15a2.25 2.25 0 0 1-2.25-2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 18.409a2.25 2.25 0 0 1-1.07-1.916V14.25"
                />
              </svg>
            }
            title={t('manuscript.binder.empty')}
            description={t('manuscript.binder.emptyHint')}
          />
        ) : (
          sorted.map((n) => {
            const depth = binderDepth(n, byId);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                className={`w-full text-left rounded px-2 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-interactive)] focus-visible:outline-none ${
                  selectedId === n.id
                    ? 'bg-[var(--sc-accent)]/20 text-[var(--sc-text-primary)]'
                    : 'hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]'
                }`}
                style={{ paddingLeft: `${8 + depth * 12}px` }}
              >
                <span className="mr-1 opacity-60" aria-hidden="true">
                  {binderTypeIcon(n.type)}
                </span>
                {n.title}
              </button>
            );
          })
        )}
      </div>
      {selected && (selected.type === 'note' || selected.type === 'text') ? (
        <div className="p-2 border-t border-[var(--sc-border-subtle)] space-y-2 flex-shrink-0">
          <label htmlFor="binder-note-title" className="sr-only">
            {t('manuscript.binder.noteTitle')}
          </label>
          <input
            id="binder-note-title"
            value={selected.title}
            onChange={(e) => updateSelectedTitle(e.target.value)}
            className="w-full px-2 py-1 rounded border border-[var(--sc-border-subtle)] bg-[var(--input-background)] text-sm"
          />
          <label htmlFor="binder-note-body" className="sr-only">
            {t('manuscript.binder.noteBody')}
          </label>
          <textarea
            id="binder-note-body"
            value={selected.content ?? ''}
            onChange={(e) => updateSelectedContent(e.target.value)}
            rows={6}
            className="w-full px-2 py-1 rounded border border-[var(--sc-border-subtle)] bg-[var(--input-background)] text-sm resize-y"
            placeholder={t('manuscript.binder.notePlaceholder')}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={pinForSplit}
          >
            {t('manuscript.binder.openInSplit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-400 w-full"
            onClick={handleDeleteSelected}
          >
            {t('manuscript.binder.deleteNode')}
          </Button>
        </div>
      ) : null}
      {selected && selected.type === 'link' && selected.linkUrl ? (
        <div className="p-2 border-t border-[var(--sc-border-subtle)] space-y-2 flex-shrink-0">
          <a
            href={selected.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--accent-primary)] underline break-all focus-visible:ring-2 rounded"
          >
            {selected.linkUrl}
          </a>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={pinForSplit}
          >
            {t('manuscript.binder.openInSplit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-400 w-full"
            onClick={handleDeleteSelected}
          >
            {t('manuscript.binder.deleteNode')}
          </Button>
        </div>
      ) : null}
      {selected &&
      (selected.type === 'pdf' || selected.type === 'image' || selected.type === 'text') &&
      selected.binderAssetId ? (
        <div className="p-2 border-t border-[var(--sc-border-subtle)] space-y-2 flex-shrink-0">
          <BinderAssetPreview projectId={pid} node={selected} t={t} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={pinForSplit}
          >
            {t('manuscript.binder.openInSplit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-400 w-full"
            onClick={handleDeleteSelected}
          >
            {t('manuscript.binder.deleteNode')}
          </Button>
        </div>
      ) : null}
      {selected && selected.type === 'folder' ? (
        <div className="p-2 border-t border-[var(--sc-border-subtle)] flex-shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-400 w-full"
            onClick={handleDeleteSelected}
          >
            {t('manuscript.binder.deleteFolder')}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
