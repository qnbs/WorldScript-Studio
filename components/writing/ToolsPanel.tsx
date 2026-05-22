// QNBS-v3: Extracted from WriterView.tsx; renderToolInputs moved to ToolInputs.tsx to stay ≤350 lines
import type { FC } from 'react';
import React from 'react';
import { ICONS } from '../../constants';
import { useWriterViewContext } from '../../contexts/WriterViewContext';
import type { WriterTool } from '../../features/writer/writerSlice';
import { writerActions } from '../../features/writer/writerSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';
import { ToolInputs } from './ToolInputs';

const ToolsPanel: FC = React.memo(() => {
  const { t } = useTranslation();
  const { writerState, dispatch, isGenerateDisabled, handleGenerate } = useWriterViewContext();
  const { activeTool, tone, style, isLoading } = writerState;

  const presetTones = [
    'More Cinematic',
    'More Suspenseful',
    'More Humorous',
    'More Formal',
    'More Poetic',
  ];
  const isCustomTone = tone && !presetTones.includes(tone);

  const handleToneSelect = (val: string) => {
    if (val === 'Custom') {
      if (!isCustomTone) dispatch(writerActions.setTone(''));
    } else {
      dispatch(writerActions.setTone(val));
    }
  };

  const tools = [
    { id: 'continue', title: t('writer.studio.tools.continue.title'), icon: ICONS.CONTINUE },
    { id: 'improve', title: t('writer.studio.tools.improve.title'), icon: ICONS.IMPROVE },
    { id: 'changeTone', title: t('writer.studio.tools.changeTone.title'), icon: ICONS.CHANGE_TONE },
    { id: 'dialogue', title: t('writer.studio.tools.dialogue.title'), icon: ICONS.DIALOGUE },
    { id: 'brainstorm', title: t('writer.studio.tools.brainstorm.title'), icon: ICONS.BRAINSTORM },
    { id: 'synopsis', title: t('writer.studio.tools.synopsis.title'), icon: ICONS.NEWSPAPER },
    { id: 'grammarCheck', title: t('writer.studio.tools.grammarCheck.title'), icon: ICONS.CHECK },
    { id: 'critic', title: t('writer.studio.tools.critic.title'), icon: ICONS.CHECK },
    { id: 'plotholes', title: t('writer.studio.tools.plotholes.title'), icon: ICONS.CHECK },
    { id: 'consistency', title: t('writer.studio.tools.consistency.title'), icon: ICONS.CHECK },
    { id: 'imagePrompt', title: 'Bild-Prompt', icon: ICONS.PHOTO },
  ];

  return (
    <div className="h-full flex flex-col">
      <Card className="h-full flex flex-col sticky top-0 lg:top-20 border-0 sm:border">
        <CardHeader className="hidden md:block space-y-2">
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('writer.studio.tools.title')}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1.5 text-[var(--sc-text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={writerState.useRagContext}
                onChange={(e) => dispatch(writerActions.setUseRagContext(e.target.checked))}
                className="rounded border-[var(--sc-border-subtle)]"
              />
              {t('writer.studio.rag.useContext')}
            </label>
            {writerState.lastRagChunkCount > 0 && (
              <span
                className="px-2 py-0.5 rounded-full bg-[var(--sc-accent)]/15 text-[var(--sc-ring-focus)] border border-[var(--sc-border-subtle)]"
                title={t('writer.studio.rag.chunksHint')}
              >
                {t('writer.studio.rag.chunksBadge', {
                  count: String(writerState.lastRagChunkCount),
                })}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col space-y-4 flex-grow overflow-hidden p-4 sm:p-6">
          {/* biome-ignore lint/a11y/useSemanticElements: role="group" on a div is appropriate for a toolbar of tool-select buttons; fieldset requires a legend child and the grid layout makes that impractical. */}
          <div
            className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-5 gap-2 flex-shrink-0"
            role="group"
            aria-label={t('writer.tools.selectLabel')}
          >
            {tools.map((tool) => (
              <button
                type="button"
                key={tool.id}
                title={tool.title}
                onClick={() => dispatch(writerActions.setActiveTool(tool.id as WriterTool))}
                className={`flex flex-col items-center justify-center p-2 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--sc-ring-focus)] active:scale-95 touch-manipulation min-h-[44px] min-w-[44px] ${
                  activeTool === tool.id
                    ? 'bg-[var(--sc-accent)] text-white shadow-md transform scale-[1.02]'
                    : 'bg-[var(--glass-bg)] text-[var(--sc-text-secondary)] hover:bg-[var(--glass-bg-hover)] border border-[var(--sc-border-subtle)]'
                }`}
                aria-label={tool.title}
                aria-pressed={activeTool === tool.id}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6 mb-1"
                  aria-hidden="true"
                >
                  {tool.icon}
                </svg>
                <span className="text-[10px] text-center leading-none hidden sm:block">
                  {tool.title.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>

          <div className="flex-grow p-4 bg-[var(--sc-surface-base)] rounded-lg border border-[var(--sc-border-subtle)] space-y-4 overflow-y-auto">
            <h3 className="text-base font-bold text-[var(--sc-text-primary)] flex items-center gap-2">
              {tools.find((t) => t.id === activeTool)?.icon}
              {tools.find((t) => t.id === activeTool)?.title}
            </h3>
            <div className="space-y-4">
              <ToolInputs
                activeTool={activeTool}
                tone={tone}
                isCustomTone={isCustomTone}
                onToneSelect={handleToneSelect}
              />
            </div>

            {(activeTool === 'continue' || activeTool === 'improve') && (
              <div className="pt-4 border-t border-[var(--sc-border-subtle)]">
                <h3 className="text-sm font-semibold text-[var(--sc-text-primary)] mb-2">
                  {t('writer.studio.controls.title')}
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label
                      htmlFor="style"
                      className="text-xs font-medium text-[var(--sc-text-muted)] mb-1 block"
                    >
                      {t('writer.studio.controls.style')}
                    </label>
                    <Select
                      id="style"
                      value={style}
                      onChange={(e) => dispatch(writerActions.setStyle(e.target.value))}
                    >
                      <option value="">{t('writer.studio.controls.default')}</option>
                      <option value="Cinematic">
                        {t('writer.studio.controls.styles.cinematic')}
                      </option>
                      <option value="Concise">{t('writer.studio.controls.styles.concise')}</option>
                      <option value="Descriptive">
                        {t('writer.studio.controls.styles.descriptive')}
                      </option>
                      <option value="Minimalist">
                        {t('writer.studio.controls.styles.minimalist')}
                      </option>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 pt-2">
            {isLoading ? (
              <Button
                onClick={handleGenerate}
                variant="danger"
                className="w-full py-3 text-base shadow-lg animate-pulse"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mr-2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
                  />
                </svg>
                {t('writer.stopGenerating')}
              </Button>
            ) : (
              <Button
                onClick={handleGenerate}
                disabled={isGenerateDisabled()}
                className="w-full py-3 text-base shadow-lg"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mr-2"
                >
                  {ICONS.SPARKLES}
                </svg>
                {t('common.generate')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
ToolsPanel.displayName = 'ToolsPanel';

export { ToolsPanel };
