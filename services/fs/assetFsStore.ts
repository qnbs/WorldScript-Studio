/**
 * FsAssetFsStore — Image and Binder binary asset filesystem storage.
 * ENCRYPTION: plaintext — blob storage; at-rest encryption planned for Phase 2.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import { logger } from '../logger';
import type { BinderAssetMeta, BinderAssetPayload } from '../storageBackend';
import { retryFs, sanitizePathSegment, writeFileAtomic, writeTextFileAtomic } from './fsCore';
import { FsSnapshotStore } from './snapshotFsStore';

export class FsAssetStore extends FsSnapshotStore {
  // --- Image Store Methods ---

  async saveImage(id: string, base64Data: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const imagesPath = await apis.join(appDataPath, 'images');

    if (!(await apis.exists(imagesPath))) {
      await apis.mkdir(imagesPath, { recursive: true });
    }

    const imageFile = await apis.join(imagesPath, `${sanitizePathSegment(id, 'image')}.png`);
    // QNBS-v3: data URLs retain an uploaded image's MIME type; legacy raw payloads remain readable as PNG below.
    await writeTextFileAtomic(apis, imageFile, base64Data);
  }

  async getImage(id: string): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const imageFile = await apis.join(
        appDataPath,
        'images',
        `${sanitizePathSegment(id, 'image')}.png`,
      );

      if (!(await apis.exists(imageFile))) {
        return null;
      }

      const imageData = await retryFs(() => apis.readTextFile(imageFile));
      return imageData.startsWith('data:image/') ? imageData : `data:image/png;base64,${imageData}`;
    } catch (error) {
      logger.error('Failed to load image:', error);
      return null;
    }
  }

  async deleteImage(id: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const imageFile = await apis.join(
        appDataPath,
        'images',
        `${sanitizePathSegment(id, 'image')}.png`,
      );
      if (await apis.exists(imageFile)) {
        await retryFs(() => apis.remove(imageFile));
      }
    } catch (error) {
      logger.error('Failed to delete image:', error);
    }
  }

  // QNBS-v3: Research-Blobs pro Projekt unter projects/<id>/binder — rekursives deleteProject räumt mit auf.

  private async binderAssetPaths(projectId: string, assetId: string) {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeAsset = sanitizePathSegment(assetId, 'asset');
    const safeId = sanitizePathSegment(
      this.resolveAuxiliaryProjectId(projectId, 'binder', safeAsset),
      'project',
    );
    const dir = await apis.join(appDataPath, 'projects', safeId, 'binder');
    const binFile = await apis.join(dir, `${safeAsset}.bin`);
    const metaFile = await apis.join(dir, `${safeAsset}.meta.json`);
    return { apis, dir, binFile, metaFile };
  }

  async saveBinderAsset(
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ): Promise<void> {
    await this.withLegacyRoutingOperation(async () => {
      const apis = await this.getApis();
      const { dir, binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
      if (!(await apis.exists(dir))) await apis.mkdir(dir, { recursive: true });
      const metaOut: BinderAssetMeta = { ...meta, byteSize: data.byteLength };
      await writeFileAtomic(apis, binFile, new Uint8Array(data));
      await writeTextFileAtomic(apis, metaFile, JSON.stringify(metaOut));
    });
  }

  async getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null> {
    try {
      return await this.withLegacyRoutingOperation(async () => {
        const apis = await this.getApis();
        const { binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
        if (!(await apis.exists(binFile)) || !(await apis.exists(metaFile))) return null;
        const [bytes, metaRaw] = await Promise.all([
          retryFs(() => apis.readFile(binFile)),
          retryFs(() => apis.readTextFile(metaFile)),
        ]);
        const meta = JSON.parse(metaRaw) as BinderAssetMeta;
        // QNBS-v3: binary + metadata are two independent atomic writes, not one transaction — a byteSize mismatch is the cheapest reliable signal that a partial failure paired a new generation with a stale one.
        if (meta.byteSize !== bytes.byteLength) {
          logger.warn('getBinderAsset: byteSize/binary mismatch — treating pair as corrupt', {
            projectId,
            assetId,
            expected: meta.byteSize,
            actual: bytes.byteLength,
          });
          return null;
        }
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return { data: copy, meta };
      });
    } catch (error) {
      logger.warn('getBinderAsset failed:', error);
      return null;
    }
  }

  async deleteBinderAsset(projectId: string, assetId: string): Promise<void> {
    try {
      await this.withLegacyRoutingOperation(() => this.deleteBinderAssetStrict(projectId, assetId));
    } catch (error) {
      logger.warn('deleteBinderAsset failed:', error);
    }
  }

  protected async deleteBinderAssetStrict(projectId: string, assetId: string): Promise<void> {
    const { apis, binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
    if (await apis.exists(binFile)) await retryFs(() => apis.remove(binFile));
    if (await apis.exists(metaFile)) await retryFs(() => apis.remove(metaFile));
  }

  async listBinderAssetIds(projectId: string): Promise<string[]> {
    try {
      return await this.withLegacyRoutingOperation(() =>
        this.listBinderAssetIdsUnlocked(projectId),
      );
    } catch (error) {
      logger.warn('listBinderAssetIds failed:', error);
      return [];
    }
  }

  private async listBinderAssetIdsUnlocked(projectId: string): Promise<string[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const ids = new Set<string>();
      const legacyProjectId = this.legacyBinderProjectId(projectId);
      const safeIds = new Set(
        [projectId, legacyProjectId]
          .filter((id): id is string => Boolean(id))
          .map((id) => sanitizePathSegment(id, 'project')),
      );
      for (const safeId of safeIds) {
        try {
          const dir = await apis.join(appDataPath, 'projects', safeId, 'binder');
          if (!(await apis.exists(dir))) continue;
          const legacyOnly =
            legacyProjectId !== null && safeId !== sanitizePathSegment(projectId, 'project');
          const allowed = legacyOnly
            ? new Set(this.legacyBinderAssetIdsForProject(projectId))
            : null;
          const entries = await retryFs(() => apis.readDir(dir));
          for (const e of entries) {
            const name = e.name ?? '';
            if (name.endsWith('.meta.json')) {
              const id = name.replace(/\.meta\.json$/, '');
              if (!allowed || allowed.has(id)) ids.add(id);
            }
          }
        } catch (error) {
          // QNBS-v3: one unreadable legacy directory must not erase IDs already collected from a healthy project directory.
          logger.warn('listBinderAssetIds: skipped unreadable project directory', {
            projectId,
            safeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return [...ids];
    } catch (error) {
      logger.warn('listBinderAssetIds failed:', error);
      return [];
    }
  }

  async deleteAllBinderAssetsForProject(projectId: string): Promise<void> {
    await this.withLegacyRoutingOperation(async () => {
      const ids = await this.listBinderAssetIdsUnlocked(projectId);
      await Promise.all(
        ids.map(async (id) => {
          try {
            await this.deleteBinderAssetStrict(projectId, id);
          } catch (error) {
            logger.warn('deleteBinderAsset failed:', error);
          }
        }),
      );
    });
  }
}
