import { createAsyncThunk } from '@reduxjs/toolkit';
import { parseImportedProjectJson } from '../../../services/projectImportSchema';
import { storageService } from '../../../services/storageService';
import type { Character, World } from '../../../types';
import { charactersAdapter, worldsAdapter } from '../adapters';
import type { ProjectData } from '../projectSlice';

export const importProjectThunk = createAsyncThunk('project/importProject', async (file: File) => {
  const text = await file.text();
  const projectDataJson = parseImportedProjectJson(text);

  // QNBS-v3: setAll returns a new Immer-produced state — capture the return value, do not rely on in-place mutation
  let charactersState = charactersAdapter.getInitialState();
  let worldsState = worldsAdapter.getInitialState();
  const charactersToSet: Character[] = [];
  const worldsToSet: World[] = [];

  let characterArray: (Character & { avatarBase64?: string })[] = [];
  if (Array.isArray(projectDataJson.characters)) {
    characterArray = projectDataJson.characters as (Character & { avatarBase64?: string })[];
  } else if (projectDataJson.characters && 'ids' in projectDataJson.characters) {
    const { ids, entities } = projectDataJson.characters;
    characterArray = ids
      .map((id: string) => entities[id])
      .filter((item): item is Character & { avatarBase64?: string } => Boolean(item));
  }

  for (const char of characterArray) {
    const newChar = { ...char };
    if (newChar.avatarBase64) {
      await storageService.saveImage(newChar.id, newChar.avatarBase64);
      newChar.hasAvatar = true;
      delete newChar.avatarBase64;
    }
    charactersToSet.push(newChar);
  }
  charactersState = charactersAdapter.setAll(charactersState, charactersToSet);

  let worldArray: (World & { ambianceImageBase64?: string })[] = [];
  if (Array.isArray(projectDataJson.worlds)) {
    worldArray = projectDataJson.worlds as (World & { ambianceImageBase64?: string })[];
  } else if (projectDataJson.worlds && 'ids' in projectDataJson.worlds) {
    const { ids, entities } = projectDataJson.worlds;
    worldArray = ids
      .map((id: string) => entities[id])
      .filter((item): item is World & { ambianceImageBase64?: string } => Boolean(item));
  }

  for (const world of worldArray) {
    const newWorld = { ...world };
    if (newWorld.ambianceImageBase64) {
      await storageService.saveImage(newWorld.id, newWorld.ambianceImageBase64);
      newWorld.hasAmbianceImage = true;
      delete newWorld.ambianceImageBase64;
    }
    worldsToSet.push(newWorld);
  }
  worldsState = worldsAdapter.setAll(worldsState, worldsToSet);

  const manuscript = projectDataJson.manuscript ?? [];

  const result = {
    id: projectDataJson.id ?? 'default',
    title: projectDataJson.title,
    logline: projectDataJson.logline,
    author: projectDataJson.author,
    characters: charactersState,
    worlds: worldsState,
    outline: projectDataJson.outline ?? [],
    manuscript,
    relationships: projectDataJson.relationships,
    projectGoals: projectDataJson.projectGoals ?? {
      totalWordCount: 50000,
      targetDate: null,
    },
    writingHistory: projectDataJson.writingHistory ?? [],
    writingSessions: projectDataJson.writingSessions,
    writingGoals: projectDataJson.writingGoals,
    sceneBoardLayout: projectDataJson.sceneBoardLayout,
    binderNodes: projectDataJson.binderNodes ?? [],
    compileProfile: projectDataJson.compileProfile,
    persistedVersionControl: projectDataJson.persistedVersionControl,
  };

  // QNBS-v3: Zod inference uses | undefined for optional keys — ProjectData expects missing keys (exactOptionalPropertyTypes).
  return result as ProjectData;
});

export const restoreSnapshotThunk = createAsyncThunk(
  'project/restoreSnapshot',
  async (snapshotId: number) => {
    const data = await storageService.getSnapshotData(snapshotId);
    return data;
  },
);
