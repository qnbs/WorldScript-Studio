/**
 * FsCodexStore — Story codex and RAG vector storage on the filesystem.
 * ENCRYPTION: plaintext — project content; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import type { StoryCodex } from '../../types';
import { logger } from '../logger';
import { compressData, decompressData, retryFs, sanitizePathSegment } from './fsCore';
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
    await retryFs(() => apis.writeTextFile(codexFile, compressData(codex)));
  }

  async getStoryCodex(projectId: string): Promise<StoryCodex | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const codexFile = await apis.join(appDataPath, 'projects', safeId, 'codex', 'codex.snap');
      if (!(await apis.exists(codexFile))) return null;
      const content = await retryFs(() => apis.readTextFile(codexFile));
      return decompressData<StoryCodex>(content);
    } catch (error) {
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
    await retryFs(() => apis.writeTextFile(vectorsFile, compressData(vectors)));
  }

  async getRagVectors(projectId: string): Promise<unknown[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const vectorsFile = await apis.join(appDataPath, 'projects', safeId, 'codex', 'vectors.snap');
      if (!(await apis.exists(vectorsFile))) return [];
      const content = await retryFs(() => apis.readTextFile(vectorsFile));
      return decompressData<unknown[]>(content);
    } catch (error) {
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
