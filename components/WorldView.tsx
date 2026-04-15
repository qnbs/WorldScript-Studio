import type { FC } from 'react';
import React, { useState, useEffect, useRef } from 'react';
import type { World } from '../types';
import { ICONS } from '../constants';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Spinner } from './ui/Spinner';
import { Modal } from './ui/Modal';
import { DebouncedInput } from './ui/DebouncedInput';
import { DebouncedTextarea } from './ui/DebouncedTextarea';
import { useWorldView } from '../hooks/useWorldView';
import { WorldViewContext, useWorldViewContext } from '../contexts/WorldViewContext';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { AddNewCard } from './ui/AddNewCard';
import { dbService } from '../services/dbService';
import { useAppDispatch } from '../app/hooks';
import { uploadWorldImageThunk } from '../features/project/projectSlice';

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
  field: 'geography' | 'culture' | 'magicSystem';
  value: string;
}

const DetailField: FC<DetailFieldProps> = React.memo(({ label, field, value }) => {
  const { t, handleFieldChange, handleRegenerateField, isRegeneratingField } =
    useWorldViewContext();
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

const WorldAtlas: FC = () => {
  const {
    t,
    selectedWorld,
    handleFieldChange,
    isGeneratingProfile,
    handleGenerateImage,
    isGeneratingImage,
    setIsAtlasOpen,
    handleDelete,
    refinementPrompt,
    setRefinementPrompt,
    handleRefineImage,
    isRefiningImage,
    handleTimelineChange,
    addTimelineEvent,
    deleteTimelineEvent,
    handleLocationChange,
    addLocation,
    deleteLocation,
  } = useWorldViewContext();
  const [activeTab, setActiveTab] = useState('overview');
  const imageUrl = useStoredImage(selectedWorld?.id, selectedWorld?.hasAmbianceImage);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dispatch = useAppDispatch();

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0] && selectedWorld) {
      const file = event.target.files[0];
      await dispatch(uploadWorldImageThunk({ worldId: selectedWorld.id, file }));
    }
  };

  if (!selectedWorld) return null;

  return (
    <Modal
      isOpen={true}
      onClose={() => setIsAtlasOpen(false)}
      title={t('worlds.atlas.title', { name: selectedWorld.name })}
      size="xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
          <div className="relative aspect-video w-full rounded-lg bg-[var(--background-tertiary)]/50 flex items-center justify-center overflow-hidden border border-[var(--border-primary)]">
            {selectedWorld.hasAmbianceImage && imageUrl ? (
              <img src={imageUrl} alt={selectedWorld.name} className="w-full h-full object-cover" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-24 h-24 text-[var(--foreground-muted)]"
              >
                {ICONS.PHOTO}
              </svg>
            )}
            {(isGeneratingImage || isRefiningImage) && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-[var(--foreground-primary)]">
                <Spinner className="w-8 h-8" />{' '}
                <p className="mt-2 text-sm">{t('worlds.edit.generatingImage')}</p>
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
            <Button
              onClick={handleGenerateImage}
              disabled={isGeneratingImage || !selectedWorld.description}
              className="col-span-4"
              title={t('worlds.edit.generateImageButton')}
            >
              {isGeneratingImage ? (
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
                  {ICONS.PHOTO}
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
          {selectedWorld.hasAmbianceImage && (
            <div className="space-y-2">
              <label
                htmlFor="refine-prompt-world"
                className="text-sm font-medium text-[var(--foreground-secondary)]"
              >
                {t('worlds.atlas.refineLabel')}
              </label>
              <Input
                id="refine-prompt-world"
                placeholder={t('worlds.atlas.refinePlaceholder')}
                value={refinementPrompt}
                onChange={(e) => setRefinementPrompt(e.target.value)}
                disabled={isRefiningImage}
              />
              <Button
                onClick={handleRefineImage}
                disabled={isRefiningImage || !refinementPrompt}
                className="w-full"
              >
                {isRefiningImage ? (
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
                {t('worlds.atlas.refineButton')}
              </Button>
            </div>
          )}
        </div>
        <div className="md:col-span-2">
          <div className="flex justify-between items-center p-0 mb-2">
            <DebouncedInput
              aria-label={t('worlds.edit.name')}
              value={selectedWorld.name}
              onDebouncedChange={(value) => handleFieldChange('name', value)}
              className="bg-transparent border-0 p-0 text-2xl font-semibold text-[var(--foreground-primary)] h-auto focus:ring-0 focus:bg-[var(--foreground-primary)]/10 rounded-md px-2 w-full mr-2"
            />
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleDelete(selectedWorld.id)}
              title={t('worlds.deleteLabel', { name: selectedWorld.name })}
              aria-label={t('worlds.deleteLabel', { name: selectedWorld.name })}
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
              aria-label="World editor tabs"
              className="flex items-center space-x-1 min-w-max"
            >
              <TabButton
                active={activeTab === 'overview'}
                onClick={() => setActiveTab('overview')}
                controls="tabpanel-overview-w"
              >
                {t('worlds.tabs.overview')}
              </TabButton>
              <TabButton
                active={activeTab === 'details'}
                onClick={() => setActiveTab('details')}
                controls="tabpanel-details-w"
              >
                {t('worlds.tabs.details')}
              </TabButton>
              <TabButton
                active={activeTab === 'timeline'}
                onClick={() => setActiveTab('timeline')}
                controls="tabpanel-timeline-w"
              >
                {t('worlds.tabs.timeline')}
              </TabButton>
              <TabButton
                active={activeTab === 'locations'}
                onClick={() => setActiveTab('locations')}
                controls="tabpanel-locations-w"
              >
                {t('worlds.tabs.locations')}
              </TabButton>
              <TabButton
                active={activeTab === 'notes'}
                onClick={() => setActiveTab('notes')}
                controls="tabpanel-notes-w"
              >
                {t('worlds.tabs.notes')}
              </TabButton>
            </div>
          </div>
          <div className="p-0 pt-4 max-h-[55vh] overflow-y-auto">
            {isGeneratingProfile && (
              <div className="flex items-center justify-center space-x-2 text-[var(--foreground-secondary)] p-8">
                <Spinner />
                <p>{t('worlds.loading.profile')}</p>
              </div>
            )}
            <div
              id="tabpanel-overview-w"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'overview'}
              className="space-y-2"
            >
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                {t('worlds.edit.description')}
              </label>
              <DebouncedTextarea
                value={selectedWorld.description}
                onDebouncedChange={(value) => handleFieldChange('description', value)}
                className="min-h-[150px]"
                aria-label={t('worlds.edit.description')}
              />
            </div>
            <div
              id="tabpanel-details-w"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'details'}
              className="space-y-4"
            >
              <DetailField
                label={t('worlds.edit.geography')}
                field="geography"
                value={selectedWorld.geography}
              />
              <DetailField
                label={t('worlds.edit.culture')}
                field="culture"
                value={selectedWorld.culture}
              />
              <DetailField
                label={t('worlds.edit.magicSystem')}
                field="magicSystem"
                value={selectedWorld.magicSystem}
              />
            </div>
            <div
              id="tabpanel-timeline-w"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'timeline'}
              className="space-y-4"
            >
              {(selectedWorld.timeline || []).map((event, _index) => (
                <div
                  key={event.id}
                  className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start border border-[var(--border-primary)] bg-white/5 p-2 rounded-md"
                >
                  <Input
                    placeholder={t('worlds.edit.eraPlaceholder')}
                    value={event.era}
                    onChange={(e) => handleTimelineChange(event.id, 'era', e.target.value)}
                  />
                  <Textarea
                    placeholder={t('worlds.edit.eventPlaceholder')}
                    value={event.description}
                    onChange={(e) => handleTimelineChange(event.id, 'description', e.target.value)}
                    className="md:col-span-2 min-h-[60px]"
                    rows={2}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteTimelineEvent(event.id)}
                    className="text-red-500 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-900/50 md:col-start-3 justify-self-end"
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
              ))}
              <Button variant="secondary" size="sm" onClick={addTimelineEvent} className="w-full">
                {t('worlds.edit.addEvent')}
              </Button>
            </div>
            <div
              id="tabpanel-locations-w"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'locations'}
              className="space-y-4"
            >
              {(selectedWorld.locations || []).map((loc) => (
                <div
                  key={loc.id}
                  className="border border-[var(--border-primary)] bg-white/5 p-3 rounded-md space-y-2"
                >
                  <div className="flex justify-between items-center">
                    <Input
                      placeholder={t('worlds.edit.locationNamePlaceholder')}
                      value={loc.name}
                      onChange={(e) => handleLocationChange(loc.id, 'name', e.target.value)}
                      className="font-semibold text-[var(--foreground-primary)] bg-transparent border-0 focus:ring-1 focus:bg-[var(--background-tertiary)] h-auto"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteLocation(loc.id)}
                      className="text-red-500 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-900/50"
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
                  <Textarea
                    placeholder={t('worlds.edit.locationDescPlaceholder')}
                    value={loc.description}
                    onChange={(e) => handleLocationChange(loc.id, 'description', e.target.value)}
                    className="min-h-[80px]"
                    rows={3}
                  />
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={addLocation} className="w-full">
                {t('worlds.edit.addLocation')}
              </Button>
            </div>
            <div
              id="tabpanel-notes-w"
              role="tabpanel"
              hidden={isGeneratingProfile || activeTab !== 'notes'}
              className="space-y-2"
            >
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                {t('worlds.edit.notes')}
              </label>
              <DebouncedTextarea
                value={selectedWorld.notes}
                onDebouncedChange={(value) => handleFieldChange('notes', value)}
                className="min-h-[300px]"
                aria-label={t('worlds.edit.notes')}
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
    useWorldViewContext();
  return (
    <Modal
      isOpen={isAiModalOpen}
      onClose={() => setIsAiModalOpen(false)}
      title={t('worlds.aiModal.title')}
    >
      <div className="space-y-4">
        <p className="text-[var(--foreground-secondary)]">{t('worlds.aiModal.description')}</p>
        <DebouncedTextarea
          placeholder={t('worlds.aiModal.placeholder')}
          value={aiConcept}
          onDebouncedChange={setAiConcept}
          rows={4}
        />
        <div className="flex justify-end">
          <Button onClick={handleGenerateProfile} disabled={!aiConcept}>
            {t('worlds.aiModal.button')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const DeleteConfirmationModal: FC = () => {
  const { t, worldToDelete, setWorldToDelete, confirmDelete } = useWorldViewContext();
  if (!worldToDelete) return null;

  return (
    <Modal
      isOpen={true}
      onClose={() => setWorldToDelete(null)}
      title={t('worlds.deleteLabel', { name: worldToDelete.name })}
    >
      <div className="space-y-4">
        <p className="text-[var(--foreground-secondary)]">{t('worlds.deleteConfirm')}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setWorldToDelete(null)}>
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

const WorldCard: FC<{ world: World; animationIndex: number }> = React.memo(
  ({ world, animationIndex }) => {
    const { handleSelect } = useWorldViewContext();
    const imageUrl = useStoredImage(world.id, world.hasAmbianceImage);

    return (
      <Card
        as="button"
        onClick={() => handleSelect(world)}
        className="group text-left relative overflow-hidden transition-all duration-300 hover:-translate-y-1 animate-in"
        style={{ '--index': animationIndex } as React.CSSProperties}
      >
        <div className="aspect-video w-full bg-[var(--background-tertiary)]/50 flex items-center justify-center overflow-hidden">
          {world.hasAmbianceImage && imageUrl ? (
            <img
              src={imageUrl}
              alt={world.name}
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
              {ICONS.WORLD}
            </svg>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[var(--background-gradient-overlay-start)] via-black/40 to-transparent">
          <h3 className="font-bold text-lg text-white truncate">{world.name}</h3>
          <p className="text-sm text-gray-300 truncate">{world.description}</p>
        </div>
      </Card>
    );
  }
);
WorldCard.displayName = 'WorldCard';

const WorldViewUI: FC = () => {
  const { t, handleAddNewManually, handleAddNewWithAI, worlds, isAtlasOpen } =
    useWorldViewContext();
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
        <div className="animate-in" style={{ '--index': 0 } as React.CSSProperties}>
          <AddNewCard
            title={t('worlds.addNewManually')}
            description={t('worlds.addNewManuallyHint')}
            onClick={handleAddNewManually}
            icon={ICONS.ADD}
            variant="default"
          />
        </div>
        <div className="animate-in" style={{ '--index': 1 } as React.CSSProperties}>
          <AddNewCard
            title={t('worlds.addNewWithAI')}
            description={t('worlds.addNewWithAIHint')}
            onClick={handleAddNewWithAI}
            icon={ICONS.SPARKLES}
            variant="primary"
          />
        </div>
        {worlds.map((world, index) => (
          <WorldCard key={world.id} world={world} animationIndex={index + 2} />
        ))}
      </div>
      {isAtlasOpen && <WorldAtlas />}
      <AIProfileModal />
      <DeleteConfirmationModal />
    </div>
  );
};

export const WorldView: FC = () => {
  const contextValue = useWorldView();
  return (
    <WorldViewContext.Provider value={contextValue}>
      <WorldViewUI />
    </WorldViewContext.Provider>
  );
};
