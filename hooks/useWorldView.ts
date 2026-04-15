import { useState, useCallback } from 'react';
import { useTranslation } from './useTranslation';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectAllWorlds } from '../features/project/projectSelectors';
import {
  projectActions,
  generateWorldProfileThunk,
  regenerateWorldFieldThunk,
  generateWorldImageThunk,
} from '../features/project/projectSlice';
import type { World, WorldTimelineEvent, WorldLocation } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { storageService } from '../services/storageService';
import { useToast } from '../components/ui/Toast';

export const useWorldView = () => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const worlds = useAppSelector(selectAllWorlds);
  const toast = useToast();

  const [selectedWorld, setSelectedWorld] = useState<World | null>(null);
  const [isAtlasOpen, setIsAtlasOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiConcept, setAiConcept] = useState('');

  const [isGeneratingProfile, setIsGeneratingProfile] = useState(false);
  const [isRegeneratingField, setIsRegeneratingField] = useState<keyof World | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isRefiningImage, setIsRefiningImage] = useState(false);
  const [refinementPrompt, setRefinementPrompt] = useState('');

  const [worldToDelete, setWorldToDelete] = useState<World | null>(null);

  const handleAddNewManually = useCallback(() => {
    dispatch(projectActions.addWorld({ name: t('worlds.newWorldName') }));
  }, [dispatch, t]);

  const handleAddNewWithAI = useCallback(() => {
    setIsAiModalOpen(true);
  }, []);

  const handleGenerateProfile = useCallback(async () => {
    setIsGeneratingProfile(true);
    setIsAiModalOpen(false);
    const resultAction = await dispatch(
      generateWorldProfileThunk({ concept: aiConcept, lang: language })
    );
    if (generateWorldProfileThunk.fulfilled.match(resultAction)) {
      dispatch(projectActions.addWorld(resultAction.payload));
      toast.success(t('common.saved'), resultAction.payload.name);
    } else {
      toast.error(t('error.apiErrorTitle'));
    }
    setIsGeneratingProfile(false);
    setAiConcept('');
  }, [dispatch, aiConcept, language, toast, t]);

  const handleSelect = useCallback((world: World) => {
    setSelectedWorld(world);
    setIsAtlasOpen(true);
  }, []);

  const handleFieldChange = useCallback(
    (field: keyof World, value: string | WorldTimelineEvent[] | WorldLocation[]) => {
      if (selectedWorld) {
        const changes = { [field]: value };
        setSelectedWorld((w) => (w ? { ...w, ...changes } : null));
        dispatch(projectActions.updateWorld({ id: selectedWorld.id, changes }));
      }
    },
    [dispatch, selectedWorld]
  );

  const handleRegenerateField = useCallback(
    async (field: keyof World) => {
      if (!selectedWorld) return;
      setIsRegeneratingField(field);
      const resultAction = await dispatch(
        regenerateWorldFieldThunk({ world: selectedWorld, field, lang: language })
      );
      if (regenerateWorldFieldThunk.fulfilled.match(resultAction)) {
        handleFieldChange(resultAction.payload.field, resultAction.payload.value);
      } else {
        toast.error(t('error.apiErrorTitle'));
      }
      setIsRegeneratingField(null);
    },
    [dispatch, selectedWorld, language, handleFieldChange, toast, t]
  );

  const handleGenerateImage = useCallback(async () => {
    if (!selectedWorld || !selectedWorld.description) return;
    setIsGeneratingImage(true);
    const resultAction = await dispatch(
      generateWorldImageThunk({
        worldId: selectedWorld.id,
        description: selectedWorld.description,
        lang: language,
      })
    );
    if (generateWorldImageThunk.fulfilled.match(resultAction)) {
      setSelectedWorld((w) => (w ? { ...w, hasAmbianceImage: true } : null));
    } else {
      toast.error(t('worlds.error.imageFailed'));
    }
    setIsGeneratingImage(false);
  }, [dispatch, selectedWorld, language, t, toast]);

  const handleRefineImage = useCallback(async () => {
    if (!selectedWorld || !refinementPrompt) return;
    setIsRefiningImage(true);
    const description = `${selectedWorld.description}. Refinement: ${refinementPrompt}`;
    const resultAction = await dispatch(
      generateWorldImageThunk({ worldId: selectedWorld.id, description, lang: language })
    );
    if (!generateWorldImageThunk.fulfilled.match(resultAction)) {
      toast.error(t('worlds.error.imageFailed'));
    }
    setRefinementPrompt('');
    setIsRefiningImage(false);
  }, [dispatch, selectedWorld, refinementPrompt, language, t, toast]);

  // Timeline and Location Handlers
  const addTimelineEvent = useCallback(() => {
    if (!selectedWorld) return;
    const newEvent: WorldTimelineEvent = { id: uuidv4(), title: '', era: '', description: '' };
    handleFieldChange('timeline', [...(selectedWorld.timeline || []), newEvent]);
  }, [selectedWorld, handleFieldChange]);

  const deleteTimelineEvent = useCallback(
    (id: string) => {
      if (!selectedWorld) return;
      handleFieldChange(
        'timeline',
        selectedWorld.timeline.filter((e) => e.id !== id)
      );
    },
    [selectedWorld, handleFieldChange]
  );

  const handleTimelineChange = useCallback(
    (id: string, field: 'era' | 'description', value: string) => {
      if (!selectedWorld) return;
      handleFieldChange(
        'timeline',
        selectedWorld.timeline.map((e) => (e.id === id ? { ...e, [field]: value } : e))
      );
    },
    [selectedWorld, handleFieldChange]
  );

  const addLocation = useCallback(() => {
    if (!selectedWorld) return;
    const newLoc: WorldLocation = { id: uuidv4(), name: '', description: '', type: 'other' };
    handleFieldChange('locations', [...(selectedWorld.locations || []), newLoc]);
  }, [selectedWorld, handleFieldChange]);

  const deleteLocation = useCallback(
    (id: string) => {
      if (!selectedWorld) return;
      handleFieldChange(
        'locations',
        selectedWorld.locations.filter((l) => l.id !== id)
      );
    },
    [selectedWorld, handleFieldChange]
  );

  const handleLocationChange = useCallback(
    (id: string, field: 'name' | 'description', value: string) => {
      if (!selectedWorld) return;
      handleFieldChange(
        'locations',
        selectedWorld.locations.map((l) => (l.id === id ? { ...l, [field]: value } : l))
      );
    },
    [selectedWorld, handleFieldChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const world = worlds.find((w) => w.id === id);
      if (world) setWorldToDelete(world);
    },
    [worlds]
  );

  const confirmDelete = useCallback(async () => {
    if (worldToDelete) {
      await storageService.saveImage(worldToDelete.id, ''); // Empty string to delete
      dispatch(projectActions.deleteWorld(worldToDelete.id));
      setWorldToDelete(null);
      setIsAtlasOpen(false);
      setSelectedWorld(null);
      toast.info(t('worlds.deleteLabel', { name: worldToDelete.name }));
    }
  }, [dispatch, worldToDelete, toast, t]);

  return {
    t,
    worlds,
    selectedWorld,
    setSelectedWorld,
    isAtlasOpen,
    setIsAtlasOpen,
    isAiModalOpen,
    setIsAiModalOpen,
    aiConcept,
    setAiConcept,
    isGeneratingProfile,
    isRegeneratingField,
    isGeneratingImage,
    isRefiningImage,
    refinementPrompt,
    setRefinementPrompt,
    worldToDelete,
    setWorldToDelete,
    handleAddNewManually,
    handleAddNewWithAI,
    handleGenerateProfile,
    handleSelect,
    handleFieldChange,
    handleRegenerateField,
    handleGenerateImage,
    handleRefineImage,
    handleDelete,
    confirmDelete,
    // Timeline & Location
    addTimelineEvent,
    deleteTimelineEvent,
    handleTimelineChange,
    addLocation,
    deleteLocation,
    handleLocationChange,
  };
};

export type UseWorldViewReturnType = ReturnType<typeof useWorldView>;
