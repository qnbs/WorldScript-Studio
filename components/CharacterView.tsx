import type { FC } from 'react';
import React, { useState, useRef, useEffect } from 'react';
import type { Character } from '../types';
import { ICONS } from '../constants';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Card } from './ui/Card';
import { Spinner } from './ui/Spinner';
import { Modal } from './ui/Modal';
import { DebouncedInput } from './ui/DebouncedInput';
import { DebouncedTextarea } from './ui/DebouncedTextarea';
import { useCharacterView } from '../hooks/useCharacterView';
import { CharacterViewContext, useCharacterViewContext } from '../contexts/CharacterViewContext';
import { Select } from './ui/Select';
import { AddNewCard } from './ui/AddNewCard';
import { dbService } from '../services/dbService';
import { useAppDispatch } from '../app/hooks';
import { uploadCharacterImageThunk } from '../features/project/projectSlice';

// A local hook to fetch image data on-demand from IndexedDB
const useStoredImage = (id: string | undefined, hasImage: boolean | undefined) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    setImageUrl(null); // Reset on change
    if (!id || !hasImage) {
      return;
    }
    let isMounted = true;
    const fetchImage = async () => {
      const base64 = await dbService.getImage(id);
      if (isMounted && base64) {
        setImageUrl(`data:image/png;base64,${base64}`);
      }
    };
    fetchImage();
    return () => {
      isMounted = false;
    };
  }, [id, hasImage]);
  return imageUrl;
};

// --- SUB-COMPONENTS ---

const TabButton: FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  controls: string;
}> = React.memo(({ active, onClick, children, controls }) => (
  <button
    role="tab"
    aria-selected={active}
    aria-controls={controls}
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${active ? 'border-indigo-500 text-[var(--foreground-primary)]' : 'border-transparent text-[var(--foreground-muted)] hover:border-[var(--border-primary)] hover:text-[var(--foreground-secondary)]'}`}
  >
    {children}
  </button>
));
TabButton.displayName = 'TabButton';

interface DetailFieldProps {
  label: string;
  field:
    | 'backstory'
    | 'motivation'
    | 'personalityTraits'
    | 'flaws'
    | 'characterArc'
    | 'relationships'
    | 'appearance';
  value: string;
}

// Optimized DetailField: Takes primitive 'value' instead of full 'character' object to allow React.memo to work.
const DetailField: FC<DetailFieldProps> = React.memo(({ label, field, value }) => {
  const { t, handleFieldChange, handleRegenerateField, isRegeneratingField } =
    useCharacterViewContext();
  const fullLabel = `${t('characters.edit.regenerate')} ${label}`;
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-[var(--foreground-secondary)]">{label}</label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleRegenerateField(field)}
          disabled={isRegeneratingField === field}
          title={fullLabel}
          aria-label={fullLabel}
        >
          {isRegeneratingField === field ? (
            <Spinner />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4 text-indigo-500 dark:text-indigo-400"
              aria-hidden="true"
            >
              {ICONS.RECYCLE}
            </svg>
          )}
        </Button>
      </div>
      <DebouncedTextarea
        value={value}
        onDebouncedChange={(newValue) => handleFieldChange(field, newValue)}
        className="min-h-[120px]"
        aria-label={label}
      />
    </div>
  );
});
DetailField.displayName = 'DetailField';

const CharacterDossier: FC = () => {
  const {
    t,
    selectedCharacter,
    handleFieldChange,
    isGeneratingProfile,
    handleGeneratePortrait,
    isGeneratingPortrait,
    handleRefinePortrait,
    isRefiningPortrait,
    refinementPrompt,
    setRefinementPrompt,
    portraitStyle,
    setPortraitStyle,
    setIsDossierOpen,
    handleDelete,
    errorMessage,
  } = useCharacterViewContext();
  const [activeTab, setActiveTab] = useState('profile');
  const imageUrl = useStoredImage(selectedCharacter?.id, selectedCharacter?.hasAvatar);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dispatch = useAppDispatch();

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0] && selectedCharacter) {
      const file = event.target.files[0];
      try {
        await dispatch(
          uploadCharacterImageThunk({
            characterId: selectedCharacter.id,
            file,
          })
        );
      } catch {
        // Fehler anzeigen (Toast oder im Modal)
      }
    }
  };

  if (!selectedCharacter) return null;

  return (
    <Modal
      isOpen={true}
      onClose={() => setIsDossierOpen(false)}
      title={t('characters.dossier.title', { name: selectedCharacter.name })}
      size="xl"
    >
      {errorMessage && (
        <div className="mb-4 p-3 rounded bg-red-500/10 text-red-600 border border-red-500/30 text-sm">
          {errorMessage}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
          <div className="relative aspect-square w-full rounded-lg bg-[var(--background-tertiary)]/50 flex items-center justify-center overflow-hidden border border-[var(--border-primary)] group">
            {selectedCharacter.hasAvatar && imageUrl ? (
              <img
                src={imageUrl}
                alt={selectedCharacter.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-24 h-24 text-[var(--foreground-muted)]"
              >
                {ICONS.CHARACTERS}
              </svg>
            )}
            {(isGeneratingPortrait || isRefiningPortrait) && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-[var(--foreground-primary)]">
                <Spinner className="w-8 h-8" />{' '}
                <p className="mt-2 text-sm">{t('characters.edit.portrait.generating')}</p>
              </div>
            )}
            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
          </div>
          <div className="grid grid-cols-5 gap-2">
            <div className="col-span-5 mb-2">
              <label
                htmlFor="portrait-style-select"
                className="text-sm font-medium text-[var(--foreground-secondary)]"
              >
                {t('characters.edit.portrait.styleLabel')}
              </label>
              <Select
                id="portrait-style-select"
                value={portraitStyle}
                onChange={(e) => setPortraitStyle(e.target.value)}
              >
                <option value="digital painting">
                  {t('characters.edit.portrait.styles.digitalPainting')}
                </option>
                <option value="photorealistic">
                  {t('characters.edit.portrait.styles.photorealistic')}
                </option>
                <option value="anime">{t('characters.edit.portrait.styles.anime')}</option>
                <option value="cartoon">{t('characters.edit.portrait.styles.cartoon')}</option>
                <option value="watercolor">
                  {t('characters.edit.portrait.styles.watercolor')}
                </option>
                <option value="oil painting">
                  {t('characters.edit.portrait.styles.oilPainting')}
                </option>
                <option value="sketch">{t('characters.edit.portrait.styles.sketch')}</option>
                <option value="comic book">{t('characters.edit.portrait.styles.comicBook')}</option>
              </Select>
            </div>
            <Button
              onClick={handleGeneratePortrait}
              disabled={isGeneratingPortrait || !selectedCharacter.appearance}
              className="col-span-4"
              title={t('characters.edit.portrait.generateButton')}
            >
              {isGeneratingPortrait ? (
                <Spinner />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mr-2"
                >
                  {ICONS.CAMERA}
                </svg>
              )}
              {t('common.generate')}
            </Button>
            <Button
              onClick={handleUploadClick}
              variant="secondary"
              className="col-span-1 px-0 flex items-center justify-center"
              title="Upload Image"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            </Button>
          </div>
          {selectedCharacter.hasAvatar && (
            <div className="space-y-2">
              <label
                htmlFor="refine-prompt"
                className="text-sm font-medium text-[var(--foreground-secondary)]"
              >
                {t('characters.dossier.refineLabel')}
              </label>
              <Input
                id="refine-prompt"
                placeholder={t('characters.dossier.refinePlaceholder')}
                value={refinementPrompt}
                onChange={(e) => setRefinementPrompt(e.target.value)}
                disabled={isRefiningPortrait}
              />
              <Button
                onClick={handleRefinePortrait}
                disabled={isRefiningPortrait || !refinementPrompt}
                className="w-full"
              >
                {isRefiningPortrait ? (
                  <Spinner />
                ) : (
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
                )}
                {t('characters.dossier.refineButton')}
              </Button>
            </div>
          )}
        </div>
        <div className="md:col-span-2">
          <div className="flex justify-between items-center mb-2">
            <DebouncedInput
              aria-label={t('characters.edit.name')}
              value={selectedCharacter.name}
              onDebouncedChange={(value) => handleFieldChange('name', value)}
              className="bg-transparent border-0 p-0 text-2xl font-semibold text-[var(--foreground-primary)] h-auto focus:ring-0 focus:bg-[var(--foreground-primary)]/10 rounded-md px-2 w-full mr-2"
            />
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleDelete(selectedCharacter.id)}
              title={t('characters.deleteLabel', {
                name: selectedCharacter.name,
              })}
              aria-label={t('characters.deleteLabel', {
                name: selectedCharacter.name,
              })}
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
          <div className="border-b border-[var(--border-primary)] overflow-x-auto">
            <div
              role="tablist"
              aria-label="Character editor tabs"
              className="flex items-center space-x-1 min-w-max"
            >
              <TabButton
                active={activeTab === 'profile'}
                onClick={() => setActiveTab('profile')}
                controls="tabpanel-profile"
              >
                {t('characters.tabs.profile')}
              </TabButton>
              <TabButton
                active={activeTab === 'arc'}
                onClick={() => setActiveTab('arc')}
                controls="tabpanel-arc"
              >
                {t('characters.tabs.arc')}
              </TabButton>
              <TabButton
                active={activeTab === 'relationships'}
                onClick={() => setActiveTab('relationships')}
                controls="tabpanel-relationships"
              >
                {t('characters.tabs.relationships')}
              </TabButton>
              <TabButton
                active={activeTab === 'notes'}
                onClick={() => setActiveTab('notes')}
                controls="tabpanel-notes"
              >
                {t('characters.tabs.notes')}
              </TabButton>
            </div>
          </div>
          <div className="p-0 pt-4 max-h-[55vh] overflow-y-auto">
            {isGeneratingProfile && (
              <div className="flex items-center justify-center space-x-2 text-[var(--foreground-secondary)] p-8">
                <Spinner />
                <p>{t('characters.loading.profile')}</p>
              </div>
            )}
            <div
              id="tabpanel-profile"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'profile'}
              className="space-y-4"
            >
              <DetailField
                label={t('characters.edit.backstory')}
                field="backstory"
                value={selectedCharacter.backstory}
              />
              <DetailField
                label={t('characters.edit.motivation')}
                field="motivation"
                value={selectedCharacter.motivation}
              />
              <DetailField
                label={t('characters.edit.appearance')}
                field="appearance"
                value={selectedCharacter.appearance}
              />
              <DetailField
                label={t('characters.edit.personality')}
                field="personalityTraits"
                value={selectedCharacter.personalityTraits}
              />
              <DetailField
                label={t('characters.edit.flaws')}
                field="flaws"
                value={selectedCharacter.flaws}
              />
            </div>
            <div
              id="tabpanel-arc"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'arc'}
              className="space-y-4"
            >
              <DetailField
                label={t('characters.edit.arc')}
                field="characterArc"
                value={selectedCharacter.characterArc}
              />
            </div>
            <div
              id="tabpanel-relationships"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'relationships'}
              className="space-y-4"
            >
              <DetailField
                label={t('characters.edit.relationships')}
                field="relationships"
                value={selectedCharacter.relationships}
              />
            </div>
            <div
              id="tabpanel-notes"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'notes'}
              className="space-y-2"
            >
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                {t('characters.edit.notes')}
              </label>
              <DebouncedTextarea
                value={selectedCharacter.notes}
                onDebouncedChange={(value) => handleFieldChange('notes', value)}
                className="min-h-[300px]"
                aria-label={t('characters.edit.notes')}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const AIProfileModal: FC = () => {
  const { t, isAiModalOpen, setIsAiModalOpen, aiConcept, setAiConcept, handleGenerateProfile } =
    useCharacterViewContext();
  return (
    <Modal
      isOpen={isAiModalOpen}
      onClose={() => setIsAiModalOpen(false)}
      title={t('characters.aiModal.title')}
    >
      <div className="space-y-4">
        <p className="text-[var(--foreground-secondary)]">{t('characters.aiModal.description')}</p>
        <DebouncedTextarea
          placeholder={t('characters.aiModal.placeholder')}
          value={aiConcept}
          onDebouncedChange={setAiConcept}
          rows={4}
        />
        <div className="flex justify-end">
          <Button onClick={handleGenerateProfile} disabled={!aiConcept}>
            {t('characters.aiModal.button')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const DeleteConfirmationModal: FC = () => {
  const { t, characterToDelete, setCharacterToDelete, confirmDelete } = useCharacterViewContext();
  if (!characterToDelete) return null;

  return (
    <Modal
      isOpen={true}
      onClose={() => setCharacterToDelete(null)}
      title={t('characters.deleteLabel', { name: characterToDelete.name })}
    >
      <div className="space-y-4">
        <p className="text-[var(--foreground-secondary)]">{t('characters.deleteConfirm')}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setCharacterToDelete(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            {t('outline.confirm.deleteAction')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const CharacterCard: FC<{ character: Character; animationIndex: number }> = React.memo(
  ({ character, animationIndex }) => {
    const { handleSelect } = useCharacterViewContext();
    const imageUrl = useStoredImage(character.id, character.hasAvatar);

    return (
      <Card
        as="button"
        onClick={() => handleSelect(character)}
        className="group text-left relative overflow-hidden transition-all duration-300 hover:-translate-y-1 animate-in"
        style={{ '--index': animationIndex } as React.CSSProperties}
      >
        <div className="aspect-square w-full bg-[var(--background-tertiary)]/50 flex items-center justify-center overflow-hidden">
          {character.hasAvatar && imageUrl ? (
            <img
              src={imageUrl}
              alt={character.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-16 h-16 text-[var(--foreground-muted)]"
            >
              {ICONS.CHARACTERS}
            </svg>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[var(--background-gradient-overlay-start)] via-black/40 to-transparent">
          <h3 className="font-bold text-lg text-white truncate">{character.name}</h3>
          <p className="text-sm text-gray-300 truncate">{character.personalityTraits}</p>
        </div>
      </Card>
    );
  }
);
CharacterCard.displayName = 'CharacterCard';

const CharacterViewUI: FC = () => {
  const { t, handleAddNewManually, handleAddNewWithAI, characters, isDossierOpen } =
    useCharacterViewContext();
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
        <div className="animate-in" style={{ '--index': 0 } as React.CSSProperties}>
          <AddNewCard
            title={t('characters.addNewManually')}
            description={t('characters.addNewManuallyHint')}
            onClick={handleAddNewManually}
            icon={ICONS.ADD}
            variant="default"
          />
        </div>
        <div className="animate-in" style={{ '--index': 1 } as React.CSSProperties}>
          <AddNewCard
            title={t('characters.addNewWithAI')}
            description={t('characters.addNewWithAIHint')}
            onClick={handleAddNewWithAI}
            icon={ICONS.SPARKLES}
            variant="primary"
          />
        </div>
        {characters.map((char, index) => (
          <CharacterCard key={char.id} character={char} animationIndex={index + 2} />
        ))}
      </div>
      {isDossierOpen && <CharacterDossier />}
      <AIProfileModal />
      <DeleteConfirmationModal />
    </div>
  );
};

export const CharacterView: FC = () => {
  const contextValue = useCharacterView();
  return (
    <CharacterViewContext.Provider value={contextValue}>
      <CharacterViewUI />
    </CharacterViewContext.Provider>
  );
};
