import type { FC } from 'react';
import React from 'react';
import type { View } from '../types';
import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';
import { Input } from './ui/Input';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Spinner } from './ui/Spinner';
import { ICONS } from '../constants';
import { Select } from './ui/Select';
import { Skeleton } from './ui/Skeleton';
import { Modal } from './ui/Modal';
import { useOutlineGenerator } from '../hooks/useOutlineGenerator';
import {
  OutlineGeneratorContext,
  useOutlineGeneratorContext,
} from '../contexts/OutlineGeneratorContext';
import { Checkbox } from './ui/Checkbox';

// --- SUB-COMPONENTS ---

const IdeaForm: FC = () => {
  const {
    t,
    genre,
    setGenre,
    idea,
    setIdea,
    showAdvanced,
    setShowAdvanced,
    characters,
    setCharacters,
    setting,
    setSetting,
    pacing,
    setPacing,
    numChapters,
    setNumChapters,
    includeTwist,
    setIncludeTwist,
    isLoading,
    handleGenerate,
  } = useOutlineGeneratorContext();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
          {t('outline.idea.title')}
        </h2>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <label
            htmlFor="genre"
            className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
          >
            {t('outline.idea.genreLabel')}
          </label>
          <Input
            id="genre"
            placeholder={t('outline.idea.genrePlaceholder')}
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="idea"
            className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
          >
            {t('outline.idea.promptLabel')}
          </label>
          <Textarea
            id="idea"
            placeholder={t('outline.idea.promptPlaceholder')}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            className="min-h-[150px]"
          />
        </div>
        <div className="border-t border-[var(--border-primary)] pt-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-indigo-500 dark:text-indigo-400 font-semibold w-full text-left"
            aria-expanded={showAdvanced}
          >
            {t('outline.advanced.title')} {showAdvanced ? '(-)' : '(+)'}
          </button>
          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="characters"
                  className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
                >
                  {t('outline.advanced.charactersLabel')}
                </label>
                <Input
                  id="characters"
                  placeholder={t('outline.advanced.charactersPlaceholder')}
                  value={characters}
                  onChange={(e) => setCharacters(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="setting"
                  className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
                >
                  {t('outline.advanced.settingLabel')}
                </label>
                <Input
                  id="setting"
                  placeholder={t('outline.advanced.settingPlaceholder')}
                  value={setting}
                  onChange={(e) => setSetting(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="pacing"
                    className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
                  >
                    {t('outline.advanced.pacingLabel')}
                  </label>
                  <Select id="pacing" value={pacing} onChange={(e) => setPacing(e.target.value)}>
                    <option value="">{t('outline.advanced.pacingDefault')}</option>
                    <option value="Slow Burn">{t('outline.advanced.pacingSlow')}</option>
                    <option value="Medium Paced">{t('outline.advanced.pacingMedium')}</option>
                    <option value="Fast-Paced Thriller">{t('outline.advanced.pacingFast')}</option>
                  </Select>
                </div>
                <div>
                  <label
                    htmlFor="numChapters"
                    className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
                  >
                    {t('outline.advanced.chaptersLabel')}
                  </label>
                  <Input
                    id="numChapters"
                    type="number"
                    value={numChapters}
                    onChange={(e) => setNumChapters(Number(e.target.value) || 1)}
                    min="1"
                    max="50"
                  />
                </div>
              </div>
              <Checkbox
                id="includeTwist"
                label={t('outline.advanced.twistLabel')}
                checked={includeTwist}
                onChange={(e) => setIncludeTwist(e.target.checked)}
              />
            </div>
          )}
        </div>
        <Button onClick={handleGenerate} disabled={isLoading || !idea || !genre} className="w-full">
          {isLoading ? (
            <Spinner />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5 mr-2"
              aria-hidden="true"
            >
              {ICONS.SPARKLES}
            </svg>
          )}
          {t('outline.idea.generateButton')}
        </Button>
      </CardContent>
    </Card>
  );
};

const OutlineResult: FC = () => {
  const {
    t,
    outline,
    isLoading,
    error,
    isRegenerating,
    draggedItem,
    dragOverItem,
    handleDragSort,
    handleMove,
    updateSection,
    handleRegenerate,
    addSection,
    deleteSection,
    handleApplyOutline,
    draggingIndex,
    setDraggingIndex,
  } = useOutlineGeneratorContext();

  if (isLoading)
    return (
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('outline.result.title')}
          </h2>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-6 w-3/4 mb-4" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </CardContent>
      </Card>
    );
  if (error)
    return (
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('outline.result.title')}
          </h2>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center items-center h-full min-h-[300px] text-red-400">
            <p>{error}</p>
          </div>
        </CardContent>
      </Card>
    );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
          {t('outline.result.title')}
        </h2>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col">
        {outline.length > 0 ? (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 flex-grow">
            {outline.map((section, index) => (
              <div
                key={section.id}
                role="listitem"
                draggable
                onDragStart={() => {
                  draggedItem.current = index;
                  setDraggingIndex(index);
                }}
                onDragEnter={() => (dragOverItem.current = index)}
                onDragEnd={() => {
                  handleDragSort();
                  setDraggingIndex(null);
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                <div
                  className={`relative overflow-hidden rounded-xl border transition-all duration-300 ${section.isTwist ? 'bg-[var(--accent-1-background)]/20 border-[var(--accent-1-border)]' : 'bg-transparent border-[var(--border-primary)] hover:bg-[var(--background-secondary)]/30'} ${draggingIndex === index ? 'opacity-60 scale-[1.02] shadow-2xl shadow-indigo-500/50' : ''}`}
                >
                  <div className="p-4 border-b border-[var(--border-primary)]/50 flex justify-between items-start gap-2 bg-white/[0.01]">
                    <div className="flex-grow flex items-center gap-2">
                      <button
                        className="cursor-move text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)]"
                        title={t('outline.result.dragHandleTooltip')}
                        aria-label={t('outline.result.dragHandleTooltip')}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-5 h-5"
                        >
                          {ICONS.GRIP_VERTICAL}
                        </svg>
                      </button>
                      {section.isTwist && (
                        <span title={t('outline.result.twistTooltip')}>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className={`w-5 h-5 text-[var(--accent-1-text)]`}
                          >
                            {ICONS.LIGHTNING_BOLT}
                          </svg>
                        </span>
                      )}
                      <Input
                        value={section.title}
                        onChange={(e) => updateSection(section.id, { title: e.target.value })}
                        className="bg-transparent border-0 p-0 text-lg font-semibold text-indigo-500 dark:text-indigo-300 h-auto focus:ring-0 focus:bg-[var(--background-secondary)]/50 rounded-md px-2"
                      />
                    </div>
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0}
                        className="p-1 rounded-md hover:bg-[var(--background-secondary)] disabled:opacity-20"
                        title={t('common.moveUp')}
                        aria-label={t('common.moveUp')}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === outline.length - 1}
                        className="p-1 rounded-md hover:bg-[var(--background-secondary)] disabled:opacity-20"
                        title={t('common.moveDown')}
                        aria-label={t('common.moveDown')}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRegenerate(index)}
                        title={t('outline.result.regenerateTooltip')}
                        aria-label={t('outline.result.regenerateTooltip')}
                        disabled={!!isRegenerating}
                      >
                        {isRegenerating === section.id ? (
                          <Spinner />
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="w-5 h-5"
                          >
                            {ICONS.RECYCLE}
                          </svg>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addSection(index)}
                        title={t('outline.result.addTooltip')}
                        aria-label={t('outline.result.addTooltip')}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-5 h-5"
                        >
                          {ICONS.ADD}
                        </svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSection(section.id)}
                        title={t('outline.result.deleteTooltip')}
                        aria-label={t('outline.result.deleteTooltip')}
                        className="text-red-500 hover:bg-red-500/10 dark:hover:bg-red-900/50"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-5 h-5"
                        >
                          {ICONS.TRASH}
                        </svg>
                      </Button>
                    </div>
                  </div>
                  <div className="p-4">
                    <Textarea
                      value={section.description}
                      onChange={(e) =>
                        updateSection(section.id, {
                          description: e.target.value,
                        })
                      }
                      className="bg-transparent border-[var(--border-primary)] p-2 min-h-[100px]"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col justify-center items-center h-full min-h-[400px] text-center p-8 opacity-70 border-2 border-dashed border-[var(--border-primary)] rounded-xl bg-[var(--background-secondary)]/30">
            <div className="p-4 rounded-full bg-[var(--background-tertiary)] mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
                className="w-16 h-16 text-[var(--foreground-muted)]"
              >
                {ICONS.OUTLINE}
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[var(--foreground-primary)] mb-2">
              {t('outline.result.placeholder')}
            </h3>
            <p className="text-[var(--foreground-secondary)] max-w-sm">
              Fill out the form on the left and click Generate to see your story structure come to
              life here.
            </p>
          </div>
        )}
        {outline.length > 0 && (
          <Button className="mt-6 w-full" onClick={handleApplyOutline}>
            {t('outline.result.applyButton')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

const ConfirmationModal: FC = () => {
  const { t, confirmModal, setConfirmModal } = useOutlineGeneratorContext();
  if (!confirmModal) return null;

  return (
    <Modal isOpen={true} onClose={() => setConfirmModal(null)} title={confirmModal.title}>
      <div className="space-y-4">
        <p className="text-[var(--foreground-secondary)]">{confirmModal.description}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmModal(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={confirmModal.type === 'delete' ? 'danger' : 'primary'}
            onClick={confirmModal.onConfirm}
          >
            {confirmModal.confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const OutlineGeneratorUI: FC = () => {
  const { t: _t } = useOutlineGeneratorContext();
  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <IdeaForm />
        <OutlineResult />
      </div>
      <ConfirmationModal />
    </div>
  );
};

export const OutlineGeneratorView: React.FC<{
  onNavigate: (view: View) => void;
}> = ({ onNavigate }) => {
  const contextValue = useOutlineGenerator({ onNavigate });
  return (
    <OutlineGeneratorContext.Provider value={contextValue}>
      <OutlineGeneratorUI />
    </OutlineGeneratorContext.Provider>
  );
};
