/**
 * FsCodexStore — Story codex and RAG vector storage on the filesystem.
 * ENCRYPTION: AES-256-GCM under the real at-rest passphrase when configured and unlocked;
 * plaintext otherwise — see fsCore.ts's "Protected text files" section.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import type { StoryCodex } from '../../types';
import { logger } from '../logger';
import { isStorageAccessError } from '../storage/storageEncryptionService';
import {
  compressData,
  decompressData,
  readProtectedTextFile,
  retryFs,
  sanitizePathSegment,
  writeProtectedTextFileAtomic,
} from './fsCore';
import { FsSettingsStore } from './settingsFsStore';

export class FsCodexStore extends FsSettingsStore {
  // Story Codex — projects/{projectId}/codex/codex.snap

  async saveStoryCodex(codex: StoryCodex): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeId = sanitizePathSegment(codex.projectId, 'project');
    const codexDir = await apis.join(appDataPath, 'projects', safeId, 'codex');
    if (!(await apis.exists(codexDir))) await apis.mkdir(codexDir, { recursive: true });
    const codexFile = await apis.join(codexDir, 'codex.snap');
    // QNBS-v3: atomic + protected write — a crash/power-loss mid-write must never leave codex.snap truncated.
    await writeProtectedTextFileAtomic(apis, codexFile, compressData(codex));
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const codexFile = await apis.join(appDataPath, 'projects', safeId, 'codex', 'codex.snap');
      if (!(await apis.exists(codexFile))) return null;
      const content = await readProtectedTextFile(apis, codexFile);
      return decompressData<StoryCodex>(content);
    } catch (error) {
      // QNBS-v3: a locked session is not "no codex" — never conflate the two.
      if (isStorageAccessError(error)) throw error;
      logger.error('Failed to load story codex:', error);
      return null;
    }
  }

  async deleteStoryCodex(projectId: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const codexFile = await apis.join(appDataPath, 'projects', safeId, 'codex', 'codex.snap');
      if (await apis.exists(codexFile)) await retryFs(() => apis.remove(codexFile));
    } catch (error) {
      logger.error('Failed to delete story codex:', error);
    }
  }

  // RAG Vectors — projects/{projectId}/codex/vectors.snap

  async saveRagVectors(projectId: string, vectors: unknown[]): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeId = sanitizePathSegment(projectId, 'project');
    const codexDir = await apis.join(appDataPath, 'projects', safeId, 'codex');
    if (!(await apis.exists(codexDir))) await apis.mkdir(codexDir, { recursive: true });
    const vectorsFile = await apis.join(codexDir, 'vectors.snap');
    // QNBS-v3: atomic + protected write — same rationale as saveStoryCodex above.
    await writeProtectedTextFileAtomic(apis, vectorsFile, compressData(vectors));
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const vectorsFile = await apis.join(appDataPath, 'projects', safeId, 'codex', 'vectors.snap');
      if (!(await apis.exists(vectorsFile))) return [];
      const content = await readProtectedTextFile(apis, vectorsFile);
      return decompressData<unknown[]>(content);
    } catch (error) {
      // QNBS-v3: a locked session is not "no vectors" — never conflate the two.
      if (isStorageAccessError(error)) throw error;
      logger.error('Failed to load RAG vectors:', error);
      return [];
    }
  }

  async deleteRagVectors(projectId: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const vectorsFile = await apis.join(appDataPath, 'projects', safeId, 'codex', 'vectors.snap');
      if (await apis.exists(vectorsFile)) await retryFs(() => apis.remove(vectorsFile));
    } catch (error) {
      logger.error('Failed to delete RAG vectors:', error);
    }
  }
}
