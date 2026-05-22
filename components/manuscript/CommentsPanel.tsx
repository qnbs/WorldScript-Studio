import type { FC } from 'react';
import { useCallback, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import {
  sceneCommentsActions,
  selectCommentsBySection,
  selectUnresolvedCountBySection,
} from '../../features/sceneComments/sceneCommentsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import type { CommentReply, SceneComment } from '../../types';

// ── Thread Item ───────────────────────────────────────────────────────────────

const CommentThread: FC<{ comment: SceneComment }> = ({ comment }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [expanded, setExpanded] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');

  const handleResolve = useCallback(() => {
    dispatch(
      comment.resolved
        ? sceneCommentsActions.unresolveComment(comment.id)
        : sceneCommentsActions.resolveComment(comment.id),
    );
  }, [dispatch, comment.id, comment.resolved]);

  const handleDelete = useCallback(() => {
    dispatch(sceneCommentsActions.deleteComment(comment.id));
  }, [dispatch, comment.id]);

  const handleAddReply = useCallback(() => {
    if (!replyDraft.trim()) return;
    const reply: CommentReply = {
      id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      authorName: t('comments.you'),
      authorColor: '#6366f1',
      body: replyDraft.trim(),
    };
    dispatch(sceneCommentsActions.addReply({ commentId: comment.id, reply }));
    setReplyDraft('');
  }, [dispatch, comment.id, replyDraft, t]);

  return (
    <li
      className={`border rounded-lg p-3 ${comment.resolved ? 'opacity-60' : ''} border-[var(--sc-border-subtle)]`}
    >
      <div className="flex items-start gap-2">
        <span
          className="w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
          style={{ background: comment.authorColor }}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-[var(--sc-text-primary)]">
              {comment.authorName}
            </span>
            <span className="text-xs text-[var(--sc-text-secondary)]">
              {new Date(comment.createdAt).toLocaleDateString()}
            </span>
            {comment.resolved && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                {t('comments.resolved')}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--sc-text-primary)] break-words">{comment.body}</p>

          {/* Reply list */}
          {comment.replies.length > 0 && (
            <div className="mt-2 ml-2 space-y-2 border-l-2 border-[var(--sc-border-subtle)] pl-3">
              {comment.replies.map((r) => (
                <div key={r.id} className="text-sm">
                  <span className="font-semibold" style={{ color: r.authorColor }}>
                    {r.authorName}
                  </span>
                  <span className="text-[var(--sc-text-secondary)] text-xs ml-1">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                  <p className="text-[var(--sc-text-primary)]">{r.body}</p>
                </div>
              ))}
            </div>
          )}

          {/* Reply input */}
          {expanded && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAddReply();
                  }
                }}
                placeholder={t('comments.replyPlaceholder')}
                aria-label={t('comments.replyAriaLabel', { author: comment.authorName })}
                className="flex-1 px-2 py-1 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-sm"
              />
              <button
                type="button"
                onClick={handleAddReply}
                disabled={!replyDraft.trim()}
                className="px-2 py-1 rounded bg-[var(--sc-accent)] text-[var(--foreground-on-interactive)] text-xs disabled:opacity-50"
              >
                {t('comments.send')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-2 justify-end">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]"
        >
          {expanded ? t('comments.collapseReply') : t('comments.reply')}
        </button>
        <button
          type="button"
          onClick={handleResolve}
          className="text-xs text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]"
        >
          {comment.resolved ? t('comments.unresolve') : t('comments.resolve')}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="text-xs text-red-500 hover:text-red-600"
          aria-label={t('comments.delete')}
        >
          {t('comments.delete')}
        </button>
      </div>
    </li>
  );
};

// ── Main Panel ────────────────────────────────────────────────────────────────

export const CommentsPanel: FC<{ sectionId: string }> = ({ sectionId }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const comments = useAppSelector(selectCommentsBySection(sectionId));
  const unresolvedCount = useAppSelector(selectUnresolvedCountBySection(sectionId));
  const [newComment, setNewComment] = useState('');

  const handleAddComment = useCallback(() => {
    if (!newComment.trim()) return;
    const comment: SceneComment = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sectionId,
      createdAt: Date.now(),
      authorName: t('comments.you'),
      authorColor: '#6366f1',
      body: newComment.trim(),
      resolved: false,
      replies: [],
    };
    dispatch(sceneCommentsActions.addComment(comment));
    setNewComment('');
  }, [dispatch, sectionId, newComment, t]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--sc-text-primary)]">
          {t('comments.title')}
        </span>
        {unresolvedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            {t('comments.unresolved', { n: String(unresolvedCount) })}
          </span>
        )}
      </div>

      {/* New comment input */}
      <div className="flex flex-col gap-2">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder={t('comments.newPlaceholder')}
          aria-label={t('comments.newAriaLabel')}
          rows={2}
          className="w-full px-2 py-1.5 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-sm resize-none"
        />
        <button
          type="button"
          onClick={handleAddComment}
          disabled={!newComment.trim()}
          className="self-end px-3 py-1 rounded bg-[var(--sc-accent)] text-[var(--foreground-on-interactive)] text-xs disabled:opacity-50"
        >
          {t('comments.add')}
        </button>
      </div>

      {/* Comment list */}
      {comments.length === 0 ? (
        <p className="text-sm text-[var(--sc-text-secondary)] text-center py-4">
          {t('comments.empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <CommentThread key={c.id} comment={c} />
          ))}
        </ul>
      )}
    </div>
  );
};
