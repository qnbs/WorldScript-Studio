// QNBS-v3: Extracted from WriterView.tsx to keep each file ≤350 lines per architecture rules
import type { FC } from 'react';
import React, { useRef } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useWriterViewContext } from '../../contexts/WriterViewContext';
import { writerActions } from '../../features/writer/writerSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { resolveEditorFontFamily } from '../../services/editorTypography';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { DebouncedTextarea } from '../ui/DebouncedTextarea';
import { Select } from '../ui/Select';

const ContextPanel: FC = React.memo(() => {
  const { t } = useTranslation();
  const { project, selectedSectionId, handleContentChange, writerState, dispatch } =
    useWriterViewContext();
  const { selection, activeTool } = writerState;
  const selectedSection = project.manuscript.find((s) => s.id === selectedSectionId);
  const selectedSectionIndex = project.manuscript.findIndex((s) => s.id === selectedSectionId);
  const settings = useAppSelector((state) => state.settings);
  // QNBS-v3 (#341): must resolve to the exact same stack as the real textarea (DebouncedTextarea →
  // Textarea) — a mismatch here was the direct cause of selection/visible-text position drift.
  const editorStyles: React.CSSProperties = {
    fontFamily: resolveEditorFontFamily(settings.editorFont),
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineSpacing,
  };
  // QNBS-v3 (#341): the real textarea and the visible mirror div below can scroll independently
  // (mirror is pointer-events-none, so this is one-directional: real textarea → mirror only).
  const mirrorRef = useRef<HTMLDivElement>(null);
  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
      mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };
  const handleSelectionEvents = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const { selectionStart, selectionEnd, value } = target;
    dispatch(
      writerActions.setSelection({
        start: selectionStart,
        end: selectionEnd,
        text: value.substring(selectionStart, selectionEnd),
      }),
    );
  };
  const shouldHighlightSelection =
    (activeTool === 'improve' || activeTool === 'changeTone') && selection.text.length > 0;
  const shouldShowInsertionPoint =
    (activeTool === 'continue' || activeTool === 'dialogue' || activeTool === 'brainstorm') &&
    selection.start === selection.end;
  return (
    <div className="h-full flex flex-col">
      <Card className="h-full flex flex-col border-0 sm:border border-[var(--sc-border-subtle)] shadow-sc-md rounded-sc-lg">
        <CardHeader className="hidden md:block">
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('writer.studio.context.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-3 flex-grow flex flex-col p-4 sm:p-6 overflow-hidden">
          <div className="flex flex-col space-y-2 flex-shrink-0">
            <label
              htmlFor="writer-section-select"
              className="text-sm font-medium text-[var(--sc-text-secondary)]"
            >
              {t('writer.studio.context.sectionLabel')}
            </label>
            <Select
              id="writer-section-select"
              value={selectedSectionId || ''}
              onChange={(v) => dispatch(writerActions.setSelectedSectionId(v))}
              placeholder={t('writer.studio.context.selectSection')}
              options={project.manuscript.map((sec) => ({ value: sec.id, label: sec.title }))}
            />
          </div>
          <div className="relative flex-grow border rounded-md border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] overflow-hidden min-h-[300px]">
            {/* QNBS-v3: data-testid disambiguates Writer vs Manuscript textareas in Playwright (shared aria labelling). */}
            <DebouncedTextarea
              variant="overlay"
              data-testid="writer-studio-editor"
              value={selectedSection?.content || ''}
              onDebouncedChange={(content) =>
                selectedSectionIndex > -1 && handleContentChange(selectedSectionIndex, content)
              }
              onSelect={handleSelectionEvents}
              onMouseUp={handleSelectionEvents}
              onKeyUp={handleSelectionEvents}
              onScroll={handleTextareaScroll}
              className="h-full absolute inset-0 resize-none text-transparent caret-[var(--sc-text-primary)] z-10 p-4"
              placeholder={t('writer.studio.context.contentPlaceholder')}
              aria-label={
                selectedSection
                  ? t('writer.chapter.label', { title: selectedSection.title })
                  : t('writer.studio.context.contentPlaceholder')
              }
              aria-multiline="true"
              role="textbox"
            />
            <div
              ref={mirrorRef}
              data-testid="writer-studio-mirror"
              aria-hidden="true"
              className="absolute inset-0 p-4 leading-relaxed pointer-events-none overflow-auto whitespace-pre-wrap text-[var(--sc-text-primary)]"
              style={editorStyles}
            >
              {selectedSection?.content && (
                <>
                  <span>{selectedSection.content.substring(0, selection.start)}</span>
                  {shouldShowInsertionPoint && (
                    <span className="inline-block w-0.5 h-5 bg-[var(--sc-ring-focus)] animate-pulse ml-px -mb-1 align-middle"></span>
                  )}
                  {shouldHighlightSelection && (
                    <span className="bg-[var(--sc-accent)]/25 rounded-md">{selection.text}</span>
                  )}
                  <span>{selectedSection.content.substring(selection.end)}</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
ContextPanel.displayName = 'ContextPanel';

export { ContextPanel };
