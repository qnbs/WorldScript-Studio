import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { storageService } from '../services/storageService';
import type { BinderNode } from '../types';
import { Button } from './ui/Button';

/** QNBS-v3: Research document alongside the editor — Scrivener split without Redux overload. */
export const ManuscriptResearchSplit: FC<{
  projectId: string;
  node: BinderNode | undefined;
  onClose: () => void;
}> = ({ projectId, node, onClose }) => {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    // QNBS-v3: MIME aus Storage-Payload — node.mimeType nicht als Dependency (weniger Re-Renders).
    const aid = node?.binderAssetId;
    if (!aid) {
      setBlobUrl(null);
      return;
    }
    let revoked = false;
    let url: string | null = null;
    void (async () => {
      const payload = await storageService.getBinderAsset(projectId, aid);
      if (!payload || revoked) return;
      const blob = new Blob([payload.data], {
        type: payload.meta.mimeType || 'application/octet-stream',
      });
      url = URL.createObjectURL(blob);
      if (!revoked) setBlobUrl(url);
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [projectId, node?.binderAssetId]);

  return (
    <aside
      className="flex flex-col h-full min-w-0 border-l border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] w-[38%] max-w-xl shrink-0"
      aria-label={t('manuscript.researchSplit.title')}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-[var(--sc-border-subtle)] flex-shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-text-muted)] truncate">
          {node?.title ?? t('manuscript.researchSplit.empty')}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-xs shrink-0"
          onClick={onClose}
          aria-label={t('manuscript.researchSplit.close')}
        >
          {t('manuscript.researchSplit.close')}
        </Button>
      </div>
      <div className="flex-grow min-h-0 overflow-y-auto p-2">
        {!node ? (
          <p className="text-sm text-[var(--sc-text-muted)]">
            {t('manuscript.researchSplit.empty')}
          </p>
        ) : node.type === 'link' && node.linkUrl ? (
          <div className="space-y-2">
            <a
              href={node.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--accent-primary)] underline break-all focus-visible:ring-2 rounded"
            >
              {node.linkUrl}
            </a>
            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('manuscript.researchSplit.linkHint')}
            </p>
          </div>
        ) : node.type === 'note' || node.type === 'text' ? (
          <pre className="text-sm whitespace-pre-wrap font-sans text-[var(--sc-text-secondary)]">
            {node.content ?? ''}
          </pre>
        ) : node.binderAssetId && blobUrl ? (
          node.type === 'image' || (node.mimeType?.startsWith('image/') ?? false) ? (
            <img
              src={blobUrl}
              alt={node.title}
              className="max-w-full h-auto rounded border border-[var(--sc-border-subtle)]"
            />
          ) : node.type === 'pdf' || node.mimeType === 'application/pdf' ? (
            <iframe
              title={node.title}
              src={blobUrl}
              sandbox="allow-same-origin"
              className="w-full min-h-[60vh] rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)]"
            />
          ) : (
            <p className="text-xs text-[var(--sc-text-muted)]">
              {node.originalFileName ?? node.title}
            </p>
          )
        ) : (
          <p className="text-sm text-[var(--sc-text-muted)]">
            {t('manuscript.researchSplit.empty')}
          </p>
        )}
      </div>
    </aside>
  );
};
