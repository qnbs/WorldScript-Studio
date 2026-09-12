import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '../../../app/store';
import { logger } from '../../../services/logger';
import { parseImportedProjectJson } from '../../../services/projectImportSchema';
import { storageService } from '../../../services/storageService';
import type { Character, World } from '../../../types';
import { createPrototypeSafeEntityState } from '../adapters';
import { getProjectTargetIdentity, identityUnchanged } from '../projectIdentity';
import type { ProjectData } from '../projectSlice';

// QNBS-v3: distinguishes "genuinely nothing was there" from a read failure -- a read error is never represented as a snapshot variant, it aborts the import immediately (see the rollback loop below).
type QualifiedImageSnapshot = { kind: 'absent' } | { kind: 'present'; data: string };

type ImportedEntityCollection<T extends { id: string }> =
  | readonly T[]
  | { ids: readonly string[]; entities: Record<string, T> };

// QNBS-v3: validate normalized import correspondence before image I/O so malformed collections cannot create partial imports.
/** Extracts imported entities while requiring exact ids-to-own-entities correspondence. */
function extractImportedEntities<T extends { id: string }>(
  collection: ImportedEntityCollection<T> | undefined,
): T[] | undefined {
  if (collection === undefined) return [];
  if (!('ids' in collection)) return [...collection];
  if (
    !Array.isArray(collection.ids) ||
    typeof collection.entities !== 'object' ||
    collection.entities === null
  ) {
    return undefined;
  }

  const seenIds = new Set<string>();
  const importedEntities: T[] = [];
  for (const id of collection.ids) {
    if (typeof id !== 'string' || seenIds.has(id) || !Object.hasOwn(collection.entities, id)) {
      return undefined;
    }
    const entity = collection.entities[id];
    if (!entity || typeof entity !== 'object' || entity.id !== id) return undefined;
    seenIds.add(id);
    importedEntities.push(entity);
  }

  const entityKeys = Object.keys(collection.entities);
  if (entityKeys.length !== seenIds.size || entityKeys.some((id) => !seenIds.has(id))) {
    return undefined;
  }
  return importedEntities;
}

export const importProjectThunk = createAsyncThunk('project/importProject', async (file: File) => {
  const text = await file.text();
  const projectDataJson = parseImportedProjectJson(text);

  const charactersToSet: Character[] = [];
  const worldsToSet: World[] = [];

  const characterArray = extractImportedEntities(
    projectDataJson.characters as
      | ImportedEntityCollection<Character & { avatarBase64?: string }>
      | undefined,
  );
  const worldArray = extractImportedEntities(
    projectDataJson.worlds as
      | ImportedEntityCollection<World & { ambianceImageBase64?: string }>
      | undefined,
  );
  if (!characterArray || !worldArray) {
    throw new Error('Invalid project file: entity IDs do not match their collection entries.');
  }

  if (
    !createPrototypeSafeEntityState(characterArray) ||
    !createPrototypeSafeEntityState(worldArray)
  ) {
    throw new Error('Invalid project file: duplicate character or world entity ID.');
  }

  // QNBS-v3: characters and worlds are validated for internal duplicates SEPARATELY above and may legitimately share a raw id (they live in independent Redux entity collections) -- but the qualified image filename is keyed purely by that raw id with no entity-type discriminator, so a character AND a world with the same id that BOTH carry an image would overwrite each other's image on save. Reject only that specific combination, before any image I/O starts.
  const characterImageIds = new Set(characterArray.filter((c) => c.avatarBase64).map((c) => c.id));
  if (worldArray.some((w) => w.ambianceImageBase64 && characterImageIds.has(w.id))) {
    throw new Error(
      'Invalid project file: a character and a world with the same entity ID both have an image.',
    );
  }

  // QNBS-v3: images are project-qualified in storage now -- resolve the imported project's own id up front so both save loops use the same namespace the returned ProjectData below is assigned. A present-but-empty id is treated identically to a missing one (`||`, not `??`) and gets its own fresh generated id, not the shared 'default' fallback used elsewhere for "no active project" -- two independent no-id imports must land in two distinct namespaces, not silently collapse into the same one.
  const importedProjectId = projectDataJson.id || crypto.randomUUID();

  // QNBS-v3: a failed import must restore exactly the pre-import persistent QUALIFIED image state, not just delete whatever this attempt wrote -- re-importing into an EXISTING project id can overwrite an already-present qualified image, and a plain delete-on-failure would permanently destroy it instead of just undoing this attempt. getQualifiedImage/deleteQualifiedImage (unlike getImage/deleteImage) never consult the legacy fallback and never collapse a genuine read failure into "absent", so a snapshot taken here is provably the exact pre-mutation state of the exact key saveImage is about to overwrite; a snapshot read failure throws here and aborts before any write happens.
  const imageRollbackLog: { id: string; snapshot: QualifiedImageSnapshot }[] = [];
  try {
    for (const char of characterArray) {
      const newChar = { ...char };
      if (newChar.avatarBase64) {
        const existing = await storageService.getQualifiedImage(newChar.id, importedProjectId);
        imageRollbackLog.push({
          id: newChar.id,
          snapshot: existing !== null ? { kind: 'present', data: existing } : { kind: 'absent' },
        });
        await storageService.saveImage(newChar.id, newChar.avatarBase64, importedProjectId);
        newChar.hasAvatar = true;
        delete newChar.avatarBase64;
      }
      charactersToSet.push(newChar);
    }

    for (const world of worldArray) {
      const newWorld = { ...world };
      if (newWorld.ambianceImageBase64) {
        const existing = await storageService.getQualifiedImage(newWorld.id, importedProjectId);
        imageRollbackLog.push({
          id: newWorld.id,
          snapshot: existing !== null ? { kind: 'present', data: existing } : { kind: 'absent' },
        });
        await storageService.saveImage(
          newWorld.id,
          newWorld.ambianceImageBase64,
          importedProjectId,
        );
        newWorld.hasAmbianceImage = true;
        delete newWorld.ambianceImageBase64;
      }
      worldsToSet.push(newWorld);
    }
  } catch (error) {
    await Promise.all(
      imageRollbackLog.map(({ id, snapshot }) =>
        (snapshot.kind === 'present'
          ? storageService.saveImage(id, snapshot.data, importedProjectId)
          : storageService.deleteQualifiedImage(id, importedProjectId)
        ).catch((rollbackError: unknown) => {
          logger.error('Failed to roll back image during import failure', { id, rollbackError });
        }),
      ),
    );
    throw error;
  }
  const charactersState = createPrototypeSafeEntityState(charactersToSet);
  const worldsState = createPrototypeSafeEntityState(worldsToSet);
  if (!charactersState || !worldsState) {
    throw new Error('Invalid project file: duplicate character or world entity ID.');
  }

  const manuscript = projectDataJson.manuscript ?? [];

  const result = {
    id: importedProjectId,
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
  async (snapshotId: number, thunkApi) => {
    // QNBS-v3: capture ownership before snapshot I/O so payload contents cannot change the restore target.
    const currentSlice = (thunkApi.getState() as RootState).project?.present;
    if (!currentSlice?.data) {
      throw new Error('Cannot restore a snapshot without an active project.');
    }
    const capturedTargetIdentity = getProjectTargetIdentity(currentSlice);
    const restored = await storageService.restoreSnapshot(snapshotId, currentSlice.data);
    const liveSlice = (thunkApi.getState() as RootState).project?.present;
    if (!identityUnchanged(capturedTargetIdentity, getProjectTargetIdentity(liveSlice))) {
      throw new Error('Cannot restore a snapshot after the active project changed.');
    }
    return restored;
  },
);
