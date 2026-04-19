import { createAsyncThunk } from '@reduxjs/toolkit';
import { storageService } from '../../../services/storageService';
import type { Character, World } from '../../../types';
import { charactersAdapter, worldsAdapter } from '../adapters';
import type { ProjectData } from '../projectSlice';

interface ImportedProjectData {
  title: string;
  logline: string;
  characters: Character[] | { ids: string[]; entities: Record<string, Character> };
  worlds: World[] | { ids: string[]; entities: Record<string, World> };
  outline?: ProjectData['outline'];
  manuscript?: ProjectData['manuscript'];
  projectGoals?: ProjectData['projectGoals'];
  writingHistory?: ProjectData['writingHistory'];
}

export const importProjectThunk = createAsyncThunk('project/importProject', async (file: File) => {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid project file: not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid project file: expected a JSON object.');
  }
  const obj = parsed as ImportedProjectData;
  if (typeof obj.title !== 'string' || typeof obj.logline !== 'string') {
    throw new Error('Invalid project file: missing required "title" or "logline" field.');
  }
  if (
    obj.characters !== undefined &&
    !Array.isArray(obj.characters) &&
    typeof obj.characters !== 'object'
  ) {
    throw new Error('Invalid project file: "characters" must be an array or entity map.');
  }
  if (obj.worlds !== undefined && !Array.isArray(obj.worlds) && typeof obj.worlds !== 'object') {
    throw new Error('Invalid project file: "worlds" must be an array or entity map.');
  }

  const projectData = parsed as ImportedProjectData;
  const charactersState = charactersAdapter.getInitialState();
  const worldsState = worldsAdapter.getInitialState();
  const charactersToSet: Character[] = [];
  const worldsToSet: World[] = [];

  let characterArray: (Character & { avatarBase64?: string })[] = [];
  if (Array.isArray(projectData.characters)) {
    characterArray = projectData.characters;
  } else if (
    projectData.characters &&
    'ids' in projectData.characters &&
    'entities' in projectData.characters
  ) {
    const { ids, entities } = projectData.characters;
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
  charactersAdapter.setAll(charactersState, charactersToSet);

  let worldArray: (World & { ambianceImageBase64?: string })[] = [];
  if (Array.isArray(projectData.worlds)) {
    worldArray = projectData.worlds;
  } else if (
    projectData.worlds &&
    'ids' in projectData.worlds &&
    'entities' in projectData.worlds
  ) {
    const { ids, entities } = projectData.worlds;
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
  worldsAdapter.setAll(worldsState, worldsToSet);

  return {
    title: projectData.title,
    logline: projectData.logline,
    characters: charactersState,
    worlds: worldsState,
    outline: projectData.outline ?? [],
    manuscript: projectData.manuscript ?? [],
    projectGoals: projectData.projectGoals ?? { totalWordCount: 50000, targetDate: null },
    writingHistory: projectData.writingHistory ?? [],
  } as ProjectData;
});

export const restoreSnapshotThunk = createAsyncThunk(
  'project/restoreSnapshot',
  async (snapshotId: number) => {
    const data = await storageService.getSnapshotData(snapshotId);
    return data;
  },
);
