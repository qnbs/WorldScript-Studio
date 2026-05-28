/**
 * FsAssetFsStore — Image and Binder binary asset filesystem storage.
 * ENCRYPTION: plaintext — blob storage; at-rest encryption planned for Phase 2.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import { logger } from '../logger';
import type { BinderAssetMeta, BinderAssetPayload } from '../storageBackend';
import { retryFs, sanitizePathSegment } from './fsCore';
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
    const cleanBase64 = base64Data.replace(/^data:image\/png;base64,/, '');
    await retryFs(() => apis.writeTextFile(imageFile, cleanBase64));
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

      const base64Data = await retryFs(() => apis.readTextFile(imageFile));
      return `data:image/png;base64,${base64Data}`;
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
    const safeId = sanitizePathSegment(projectId, 'project');
    const safeAsset = sanitizePathSegment(assetId, 'asset');
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
    const apis = await this.getApis();
    const { dir, binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
    if (!(await apis.exists(dir))) await apis.mkdir(dir, { recursive: true });
    const metaOut: BinderAssetMeta = { ...meta, byteSize: data.byteLength };
    await retryFs(() => apis.writeFile(binFile, new Uint8Array(data)));
    await retryFs(() => apis.writeTextFile(metaFile, JSON.stringify(metaOut)));
  }

  async getBinderAsset(projectId: string, assetId: string): Promise<BinderAssetPayload | null> {
    try {
      const apis = await this.getApis();
      const { binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
      if (!(await apis.exists(binFile)) || !(await apis.exists(metaFile))) return null;
      const [bytes, metaRaw] = await Promise.all([
        retryFs(() => apis.readFile(binFile)),
        retryFs(() => apis.readTextFile(metaFile)),
      ]);
      const meta = JSON.parse(metaRaw) as BinderAssetMeta;
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { data: copy, meta };
    } catch (error) {
      logger.warn('getBinderAsset failed:', error);
      return null;
    }
  }

  async deleteBinderAsset(projectId: string, assetId: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const { binFile, metaFile } = await this.binderAssetPaths(projectId, assetId);
      if (await apis.exists(binFile)) await retryFs(() => apis.remove(binFile));
      if (await apis.exists(metaFile)) await retryFs(() => apis.remove(metaFile));
    } catch (error) {
      logger.warn('deleteBinderAsset failed:', error);
    }
  }

  async listBinderAssetIds(projectId: string): Promise<string[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeId = sanitizePathSegment(projectId, 'project');
      const dir = await apis.join(appDataPath, 'projects', safeId, 'binder');
      if (!(await apis.exists(dir))) return [];
      const entries = await retryFs(() => apis.readDir(dir));
      const ids = new Set<string>();
      for (const e of entries) {
        const name = e.name ?? '';
        if (name.endsWith('.meta.json')) {
          ids.add(name.replace(/\.meta\.json$/, ''));
        }
      }
      return [...ids];
    } catch (error) {
      logger.warn('listBinderAssetIds failed:', error);
      return [];
    }
  }

  async deleteAllBinderAssetsForProject(projectId: string): Promise<void> {
    const ids = await this.listBinderAssetIds(projectId);
    await Promise.all(ids.map((id) => this.deleteBinderAsset(projectId, id)));
  }
}
