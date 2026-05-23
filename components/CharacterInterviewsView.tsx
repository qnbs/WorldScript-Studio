import { useState } from 'react';
import {
  CharacterInterviewsViewContext,
  useCharacterInterviewsViewContext,
} from '../contexts/CharacterInterviewsViewContext';
import { useCharacterInterviewsView } from '../hooks/useCharacterInterviewsView';
import { useTranslation } from '../hooks/useTranslation';
import { ArchetypeSelector } from './character-interviews/ArchetypeSelector';
import { InterviewPanel } from './character-interviews/InterviewPanel';

function CharacterInterviewsViewContent() {
  const { t } = useTranslation();
  const {
    characters,
    selectedCharacterId,
    selectedCharacter,
    selectedInterviewId,
    selectedArchetype,
    interviews,
    selectedInterview,
    selectCharacter,
    selectInterview,
    startNewInterview,
    deleteInterview,
  } = useCharacterInterviewsViewContext();

  const [newTitle, setNewTitle] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  if (characters.length === 0) {
    return (
      // QNBS-v3: Replaced dark: prefix with sc-token — appearance presets now apply correctly.
      <div className="flex flex-1 items-center justify-center p-8 text-center text-[var(--sc-text-muted)]">
        {t('characterInterviews.noCharacters')}
      </div>
    );
  }

  // QNBS-v3: flex-col on mobile so sidebar stacks above content; w-64 sidebar would eat half a phone screen.
  return (
    <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
      {/* Left sidebar — character + interview list */}
      <aside className="flex w-full md:w-64 md:shrink-0 flex-col border-b md:border-b-0 md:border-r border-[var(--sc-border-subtle)] max-h-[40vh] md:max-h-none">
        {/* Character selector */}
        <div className="border-b border-[var(--sc-border-subtle)] p-3">
          <label
            htmlFor="ci-character-select"
            className="mb-1 block text-xs font-medium text-[var(--sc-text-muted)]"
          >
            {t('characterInterviews.selectCharacter')}
          </label>
          <select
            id="ci-character-select"
            value={selectedCharacterId ?? ''}
            onChange={(e) => selectCharacter(e.target.value)}
            className="w-full rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-2 py-1.5 text-sm text-[var(--sc-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--sc-ring-focus)]"
          >
            <option value="" disabled>
              {t('characterInterviews.selectCharacterPlaceholder')}
            </option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Interview list */}
        {selectedCharacterId && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--sc-border-subtle)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--sc-text-muted)]">
                {t('characterInterviews.interviewsForCharacter').replace(
                  '{{name}}',
                  selectedCharacter?.name ?? '',
                )}
              </span>
              <button
                type="button"
                onClick={() => setShowNewForm((v) => !v)}
                className="rounded-sc-sm px-2 py-0.5 text-xs text-[var(--sc-accent)] hover:bg-[var(--sc-accent)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              >
                {t('characterInterviews.newInterview')}
              </button>
            </div>

            {showNewForm && (
              <div className="border-b border-[var(--sc-border-subtle)] p-3">
                <ArchetypeSelector />
                {selectedArchetype && (
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={t('characterInterviews.interviewTitlePlaceholder')}
                      aria-label={t('characterInterviews.interviewTitle')}
                      className="rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-2 py-1 text-sm text-[var(--sc-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--sc-ring-focus)]"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          startNewInterview(newTitle || undefined);
                          setNewTitle('');
                          setShowNewForm(false);
                        }}
                        className="flex-1 rounded-sc-md bg-[var(--sc-accent)] py-1 text-sm text-white hover:bg-[var(--sc-accent-hover)]"
                      >
                        {t('characterInterviews.startInterview')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNewForm(false)}
                        className="rounded-sc-md border border-[var(--sc-border-subtle)] px-2 py-1 text-sm text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)]"
                      >
                        {t('characterInterviews.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div
              role="listbox"
              aria-label={t('characterInterviews.title')}
              className="flex-1 overflow-y-auto"
            >
              {interviews.length === 0 && (
                <p className="p-3 text-xs text-[var(--sc-text-muted)]">
                  {t('characterInterviews.emptyState')}
                </p>
              )}
              {interviews.map((iv) => (
                <div key={iv.id} className="group relative">
                  <div
                    role="option"
                    aria-selected={selectedInterviewId === iv.id}
                    tabIndex={0}
                    onClick={() => selectInterview(iv.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectInterview(iv.id);
                      }
                    }}
                    className={`cursor-pointer px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sc-ring-focus)] ${
                      selectedInterviewId === iv.id
                        ? 'bg-[var(--sc-accent)]/10 text-[var(--sc-accent)]'
                        : 'hover:bg-[var(--sc-surface-overlay)]'
                    }`}
                  >
                    <p className="truncate font-medium">{iv.title ?? iv.archetype}</p>
                    <p className="text-xs text-[var(--sc-text-muted)]">
                      {iv.messages.length} messages
                    </p>
                  </div>
                  {deleteConfirmId === iv.id ? (
                    <div className="flex gap-1 px-3 pb-2">
                      <button
                        type="button"
                        onClick={() => {
                          deleteInterview(iv.id);
                          setDeleteConfirmId(null);
                        }}
                        className="text-xs text-[var(--sc-danger-fg)] hover:underline"
                      >
                        {t('characterInterviews.deleteInterview')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs text-[var(--sc-text-muted)] hover:underline"
                      >
                        {t('characterInterviews.cancel')}
                      </button>
                    </div>
                  ) : (
                    // QNBS-v3: always visible on touch (group-hover never fires on mobile); md:opacity-0 restores hover-reveal on desktop.
                    <button
                      type="button"
                      aria-label={t('characterInterviews.deleteInterview')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(iv.id);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sc-sm p-2 text-[var(--sc-text-muted)] hover:text-[var(--sc-danger-fg)] md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {selectedInterview ? (
          <InterviewPanel />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--sc-text-muted)]">
            {t('characterInterviews.emptyState')}
          </div>
        )}
      </main>
    </div>
  );
}

export default function CharacterInterviewsView() {
  const value = useCharacterInterviewsView();
  const { t } = useTranslation();

  return (
    <CharacterInterviewsViewContext.Provider value={value}>
      <div className="flex h-full flex-col">
        <header className="border-b border-[var(--sc-border-subtle)] px-6 py-4">
          <h1 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('characterInterviews.title')}
          </h1>
        </header>
        <CharacterInterviewsViewContent />
      </div>
    </CharacterInterviewsViewContext.Provider>
  );
}
