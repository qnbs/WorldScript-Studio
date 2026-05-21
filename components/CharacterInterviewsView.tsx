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
      <div className="flex flex-1 items-center justify-center p-8 text-center text-gray-500 dark:text-gray-400">
        {t('characterInterviews.noCharacters')}
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left sidebar — character + interview list */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-gray-200 dark:border-gray-700">
        {/* Character selector */}
        <div className="border-b border-gray-200 p-3 dark:border-gray-700">
          <label
            htmlFor="ci-character-select"
            className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            {t('characterInterviews.selectCharacter')}
          </label>
          <select
            id="ci-character-select"
            value={selectedCharacterId ?? ''}
            onChange={(e) => selectCharacter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
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
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('characterInterviews.interviewsForCharacter').replace(
                  '{{name}}',
                  selectedCharacter?.name ?? '',
                )}
              </span>
              <button
                type="button"
                onClick={() => setShowNewForm((v) => !v)}
                className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                {t('characterInterviews.newInterview')}
              </button>
            </div>

            {showNewForm && (
              <div className="border-b border-gray-200 p-3 dark:border-gray-700">
                <ArchetypeSelector />
                {selectedArchetype && (
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder={t('characterInterviews.interviewTitlePlaceholder')}
                      aria-label={t('characterInterviews.interviewTitle')}
                      className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          startNewInterview(newTitle || undefined);
                          setNewTitle('');
                          setShowNewForm(false);
                        }}
                        className="flex-1 rounded bg-blue-600 py-1 text-sm text-white hover:bg-blue-700"
                      >
                        {t('characterInterviews.startInterview')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNewForm(false)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600"
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
                <p className="p-3 text-xs text-gray-400">{t('characterInterviews.emptyState')}</p>
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
                    className={`cursor-pointer px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                      selectedInterviewId === iv.id
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <p className="truncate font-medium">{iv.title ?? iv.archetype}</p>
                    <p className="text-xs text-gray-400">{iv.messages.length} messages</p>
                  </div>
                  {deleteConfirmId === iv.id ? (
                    <div className="flex gap-1 px-3 pb-2">
                      <button
                        type="button"
                        onClick={() => {
                          deleteInterview(iv.id);
                          setDeleteConfirmId(null);
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t('characterInterviews.deleteInterview')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs text-gray-400 hover:underline"
                      >
                        {t('characterInterviews.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('characterInterviews.deleteInterview')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(iv.id);
                      }}
                      className="absolute right-2 top-2 hidden rounded p-1 text-gray-400 hover:text-red-500 group-hover:block"
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
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            {t('characterInterviews.emptyState')}
          </div>
        )}
      </main>
    </div>
  );
}

export default function CharacterInterviewsView() {
  const value = useCharacterInterviewsView();

  return (
    <CharacterInterviewsViewContext.Provider value={value}>
      <div className="flex h-full flex-col">
        <header className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            Character Interviews
          </h1>
        </header>
        <CharacterInterviewsViewContent />
      </div>
    </CharacterInterviewsViewContext.Provider>
  );
}
