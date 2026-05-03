import LZString from 'lz-string';

// Dynamic imports for Tauri v2 plugin APIs — fail gracefully in browser
let tauriApis: {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  readDir: (path: string) => Promise<{ name?: string; isDirectory?: boolean }[]>;
  remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  open: (opts?: Record<string, unknown>) => Promise<string | null>;
  save: (opts?: Record<string, unknown>) => Promise<string | null>;
  appDataDir: () => Promise<string>;
  join: (...parts: string[]) => Promise<string>;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
} | null = null;

async function loadTauriApis() {
  if (tauriApis) return tauriApis;
  try {
    const [coreModule, fsModule, dialogModule, pathModule] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/path'),
    ]);
    tauriApis = {
      invoke: coreModule.invoke as NonNullable<typeof tauriApis>['invoke'],
      readTextFile: fsModule.readTextFile,
      writeTextFile: fsModule.writeTextFile,
      mkdir: fsModule.mkdir,
      exists: fsModule.exists,
      readDir: fsModule.readDir as NonNullable<typeof tauriApis>['readDir'],
      remove: fsModule.remove,
      open: dialogModule.open as NonNullable<typeof tauriApis>['open'],
      save: dialogModule.save as NonNullable<typeof tauriApis>['save'],
      appDataDir: pathModule.appDataDir,
      join: pathModule.join,
    };
    return tauriApis;
  } catch {
    throw new Error('Tauri APIs not available in this environment');
  }
}

// --- Retry helper for transient filesystem errors ---
async function retryFs<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isTransient =
        msg.includes('busy') ||
        msg.includes('temporarily') ||
        msg.includes('locked') ||
        msg.includes('try again') ||
        msg.includes('resource unavailable');
      if (!isTransient || attempt >= retries) break;
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw lastError;
}

// --- LZ-String compression (mirrors dbService threshold and prefix) ---
const COMPRESS_THRESHOLD = 10_240;
const LZ_PREFIX = '\x00lz1\x00';

function compressData<T>(data: T): string {
  const json = JSON.stringify(data);
  if (json.length < COMPRESS_THRESHOLD) return json;
  return LZ_PREFIX + LZString.compressToUTF16(json);
}

function decompressData<T>(raw: string): T {
  if (raw.startsWith(LZ_PREFIX)) {
    const decompressed = LZString.decompressFromUTF16(raw.slice(LZ_PREFIX.length));
    return JSON.parse(decompressed ?? '{}') as T;
  }
  return JSON.parse(raw) as T;
}

// --- Crypto helpers ---
async function deriveFileSystemCryptoKey(secretMaterial: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = encoder.encode(secretMaterial);
  const hash = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const stripControlChars = (value: string): string => {
  let output = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (!char) continue;
    const code = char.charCodeAt(0);
    output += code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) ? ' ' : char;
  }
  return output;
};

const sanitizePathSegment = (segment: string, fallback = 'item'): string => {
  const raw = stripControlChars(String(segment).trim());
  const cleaned = raw
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
};

async function encryptText(
  value: string,
  secretMaterial: string,
): Promise<{ iv: string; data: string }> {
  const key = await deriveFileSystemCryptoKey(secretMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    iv: btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(iv)))),
    data: btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(encrypted)))),
  };
}

async function decryptText(
  payload: { iv: string; data: string },
  secretMaterial: string,
): Promise<string> {
  const key = await deriveFileSystemCryptoKey(secretMaterial);
  const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
  const encrypted = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

function countProjectWords(projectData: unknown): number {
  try {
    const proj = projectData as { manuscript?: { content?: string }[] };
    if (!Array.isArray(proj?.manuscript)) return 0;
    const fullText = proj.manuscript.map((s) => s.content ?? '').join(' ');
    return fullText.split(/\s+/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

import type { EntityState } from '@reduxjs/toolkit';
import type {
  Character,
  ProjectSnapshot,
  Settings,
  StoryCodex,
  StoryProject,
  World,
} from '../types';
import { logger } from './logger';
import { DEFAULT_WEBRTC_SIGNALING_URLS } from './collaborationService';
import {
  normalizeSaveProjectInputToStoryProject,
  type SaveProjectInput,
  type StorageBackend,
} from './storageBackend';

// Envelope stored in each snapshot file — outer shell is plain JSON, `data` field is compressed.
interface SnapshotEnvelope {
  id: number;
  name: string;
  date: string;
  wordCount: number;
  data: string; // compressData(projectData)
}

class FileSystemService implements StorageBackend {
  private appDataPath: string | null = null;

  // --- Auto-snapshot state ---
  private lastAutoSnapshotTime = Date.now();
  private readonly AUTO_SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_AUTO_SNAPSHOTS = 20;

  async initialize(): Promise<void> {
    try {
      const apis = await loadTauriApis();
      this.appDataPath = await apis.appDataDir();
    } catch (error) {
      logger.error('Failed to get app data directory:', error);
      throw error;
    }
  }

  private async ensureAppDataPath(): Promise<string> {
    if (!this.appDataPath) {
      await this.initialize();
    }
    return this.appDataPath!;
  }

  private async getApis() {
    return await loadTauriApis();
  }

  // Project management
  async saveProject(project: SaveProjectInput): Promise<void> {
    const flat = normalizeSaveProjectInputToStoryProject(project);

    // Auto-snapshot: fire-and-forget, mirrors dbService behaviour
    if (Date.now() - this.lastAutoSnapshotTime > this.AUTO_SNAPSHOT_INTERVAL) {
      this.lastAutoSnapshotTime = Date.now();
      this.saveSnapshot('auto', flat)
        .then(() => this.pruneAutoSnapshots())
        .catch(() => {});
    }

    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const projectId = sanitizePathSegment(
      ((flat as unknown as Record<string, unknown>)['id'] as string) ||
        flat.title ||
        'project',
    );
    const projectPath = await apis.join(appDataPath, 'projects', projectId);

    if (!(await apis.exists(projectPath))) {
      await apis.mkdir(projectPath, { recursive: true });
    }

    const projectFile = await apis.join(projectPath, 'project.json');
    await retryFs(() => apis.writeTextFile(projectFile, compressData(flat)));
  }

  async loadProject(projectId: string): Promise<StoryProject | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const safeProjectId = sanitizePathSegment(projectId);
      const projectFile = await apis.join(appDataPath, 'projects', safeProjectId, 'project.json');

      if (!(await apis.exists(projectFile))) {
        return null;
      }

      const content = await retryFs(() => apis.readTextFile(projectFile));
      return decompressData<StoryProject>(content);
    } catch (error) {
      logger.error('Failed to load project:', error);
      return null;
    }
  }

  async listProjects(): Promise<string[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const projectsPath = await apis.join(appDataPath, 'projects');

      if (!(await apis.exists(projectsPath))) {
        return [];
      }

      const entries = await retryFs(() => apis.readDir(projectsPath));
      return entries.filter((entry) => entry.name).map((entry) => entry.name as string);
    } catch (error) {
      logger.error('Failed to list projects:', error);
      return [];
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeProjectId = sanitizePathSegment(projectId);
    const projectPath = await apis.join(appDataPath, 'projects', safeProjectId);

    if (await apis.exists(projectPath)) {
      await retryFs(() => apis.remove(projectPath, { recursive: true }));
    }
  }

  // Image operations
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

  async hasSavedData(): Promise<boolean> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const projectsPath = await apis.join(appDataPath, 'projects');
      if (!(await apis.exists(projectsPath))) return false;
      const entries = await retryFs(() => apis.readDir(projectsPath));
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  // Settings operations
  async saveSettings(settings: Settings): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');

    if (!(await apis.exists(configPath))) {
      await apis.mkdir(configPath, { recursive: true });
    }

    const settingsFile = await apis.join(configPath, 'settings.json');
    await retryFs(() => apis.writeTextFile(settingsFile, JSON.stringify(settings, null, 2)));
  }

  async loadSettings(): Promise<Settings | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const settingsFile = await apis.join(appDataPath, 'config', 'settings.json');

      if (!(await apis.exists(settingsFile))) {
        return null;
      }

      const content = await retryFs(() => apis.readTextFile(settingsFile));
      const parsed = JSON.parse(content) as Settings;
      const collabDefaults = {
        realTimeCollaboration: false,
        publicSharing: false,
        commentSystem: false,
        versionHistory: true,
        webrtcSignalingUrls: [...DEFAULT_WEBRTC_SIGNALING_URLS],
      };
      parsed.collaboration = {
        ...collabDefaults,
        ...(parsed.collaboration ?? {}),
      };
      if (
        !parsed.collaboration.webrtcSignalingUrls ||
        parsed.collaboration.webrtcSignalingUrls.length === 0
      ) {
        parsed.collaboration.webrtcSignalingUrls = [...DEFAULT_WEBRTC_SIGNALING_URLS];
      }
      return parsed;
    } catch (error) {
      logger.error('Failed to load settings:', error);
      return null;
    }
  }

  // Gemini API key storage
  async saveGeminiApiKey(apiKey: string): Promise<void> {
    return this.saveApiKey('gemini', apiKey);
  }

  async getGeminiApiKey(): Promise<string | null> {
    return this.getApiKey('gemini');
  }

  async clearGeminiApiKey(): Promise<void> {
    return this.clearApiKey('gemini');
  }

  // Generic provider API key — stored encrypted in app data dir
  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    if (!apiKey?.trim()) {
      throw new Error('API key cannot be empty');
    }

    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');
    if (!(await apis.exists(configPath))) await apis.mkdir(configPath, { recursive: true });

    const encrypted = await encryptText(
      apiKey.trim(),
      `${appDataPath}|${provider}|StoryCraftStudio|v1`,
    );
    const filePath = await apis.join(configPath, `${provider}_key.enc.json`);
    await retryFs(() => apis.writeTextFile(filePath, JSON.stringify(encrypted)));
  }

  async getApiKey(provider: string): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const keyFile = await apis.join(appDataPath, 'config', `${provider}_key.enc.json`);
      if (!(await apis.exists(keyFile))) return null;
      const content = await retryFs(() => apis.readTextFile(keyFile));
      const payload = JSON.parse(content) as { iv: string; data: string };
      return await decryptText(payload, `${appDataPath}|${provider}|StoryCraftStudio|v1`);
    } catch (error) {
      logger.warn(`Failed to decrypt API key for provider "${provider}":`, error);
      return null;
    }
  }

  async clearApiKey(provider: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const keyFile = await apis.join(appDataPath, 'config', `${provider}_key.enc.json`);
      if (await apis.exists(keyFile)) await retryFs(() => apis.remove(keyFile));
    } catch {
      /* ignore */
    }
  }

  // Snapshot operations
  async saveSnapshot(snapshotLabel: string, data: unknown): Promise<number> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const snapshotsPath = await apis.join(appDataPath, 'snapshots');

    if (!(await apis.exists(snapshotsPath))) {
      await apis.mkdir(snapshotsPath, { recursive: true });
    }

    const id = Date.now();
    const envelope: SnapshotEnvelope = {
      id,
      name: snapshotLabel,
      date: new Date().toISOString(),
      wordCount: countProjectWords(data),
      data: compressData(data),
    };
    const snapshotFile = await apis.join(snapshotsPath, `${id}.json`);
    await retryFs(() => apis.writeTextFile(snapshotFile, JSON.stringify(envelope)));
    return id;
  }

  async getSnapshotData(snapshotId: number): Promise<unknown> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotFile = await apis.join(appDataPath, 'snapshots', `${snapshotId}.json`);

      if (!(await apis.exists(snapshotFile))) {
        return null;
      }

      const content = await retryFs(() => apis.readTextFile(snapshotFile));
      const envelope = JSON.parse(content) as SnapshotEnvelope;
      // New format: envelope with compressed data field
      if (envelope && typeof envelope.data === 'string') {
        return decompressData(envelope.data);
      }
      // Legacy format: raw project data stored directly
      return envelope;
    } catch (error) {
      logger.error('Failed to load snapshot:', error);
      return null;
    }
  }

  async listSnapshots(): Promise<ProjectSnapshot[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotsPath = await apis.join(appDataPath, 'snapshots');

      if (!(await apis.exists(snapshotsPath))) {
        return [];
      }

      const entries = await retryFs(() => apis.readDir(snapshotsPath));
      const jsonFiles = entries.filter((e) => e.name?.endsWith('.json'));

      const snapshots = await Promise.all(
        jsonFiles.map(async (entry) => {
          try {
            const filePath = await apis.join(snapshotsPath, entry.name!);
            const content = await retryFs(() => apis.readTextFile(filePath));
            const envelope = JSON.parse(content) as Partial<SnapshotEnvelope>;
            const numericId = parseInt(entry.name!.replace('.json', ''), 10);
            return {
              id: Number.isFinite(numericId) ? numericId : 0,
              name: envelope.name ?? entry.name!.replace('.json', ''),
              date: envelope.date ?? '',
              wordCount: envelope.wordCount ?? 0,
            } as ProjectSnapshot;
          } catch {
            return null;
          }
        }),
      );

      return (snapshots.filter(Boolean) as ProjectSnapshot[]).sort((a, b) => b.id - a.id);
    } catch (error) {
      logger.error('Failed to list snapshots:', error);
      return [];
    }
  }

  async deleteSnapshot(snapshotId: number): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotFile = await apis.join(appDataPath, 'snapshots', `${snapshotId}.json`);

      if (await apis.exists(snapshotFile)) {
        await retryFs(() => apis.remove(snapshotFile));
      }
    } catch (error) {
      logger.error('Failed to delete snapshot:', error);
    }
  }

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

  private async pruneAutoSnapshots(): Promise<void> {
    try {
      const snapshots = await this.listSnapshots();
      if (snapshots.length <= this.MAX_AUTO_SNAPSHOTS) return;
      const sorted = [...snapshots].sort((a, b) => a.id - b.id);
      const toDelete = sorted.slice(0, snapshots.length - this.MAX_AUTO_SNAPSHOTS);
      await Promise.all(toDelete.map((s) => this.deleteSnapshot(s.id)));
    } catch (error) {
      logger.warn('Failed to prune auto snapshots:', error);
    }
  }

  // Import/Export functionality
  async exportProject(
    project: StoryProject,
    format: 'json' | 'markdown' | 'docx' = 'json',
  ): Promise<void> {
    const apis = await this.getApis();
    let fileName: string;
    let content: string;
    let extension: string;

    switch (format) {
      case 'json':
        fileName = `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
        content = JSON.stringify(project, null, 2);
        extension = 'json';
        break;
      case 'markdown':
        fileName = `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
        content = this.convertToMarkdown(project);
        extension = 'md';
        break;
      case 'docx':
        fileName = `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
        content = this.convertToMarkdown(project);
        extension = 'md';
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const filePath = await apis.save({
      defaultPath: `${fileName}.${extension}`,
      filters: [{ name: format.toUpperCase(), extensions: [extension] }],
    });

    if (filePath) {
      await retryFs(() => apis.writeTextFile(filePath, content));
    }
  }

  async importProject(): Promise<StoryProject | null> {
    const apis = await this.getApis();
    const filePath = await apis.open({
      multiple: false,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!filePath || Array.isArray(filePath)) {
      return null;
    }

    const content = await retryFs(() => apis.readTextFile(filePath));

    if (filePath.endsWith('.json')) {
      return JSON.parse(content);
    } else if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
      return this.parseMarkdownProject(content);
    }

    throw new Error('Unsupported file format');
  }

  private convertToMarkdown(project: StoryProject): string {
    const characters = Array.isArray(project.characters)
      ? project.characters
      : (Object.values((project.characters as EntityState<Character, string>).entities).filter(
          Boolean,
        ) as Character[]);
    const worlds = Array.isArray(project.worlds)
      ? project.worlds
      : (Object.values((project.worlds as EntityState<World, string>).entities).filter(
          Boolean,
        ) as World[]);
    const markdown = `---
title: "${project.title}"
---

# ${project.title}

## Characters

${characters
  .map(
    (char: Character) => `### ${char.name}

${char.backstory || ''}

**Personality:** ${char.personalityTraits || ''}
**Motivation:** ${char.motivation || ''}
**Appearance:** ${char.appearance || ''}

`,
  )
  .join('\n')}

## Worlds

${worlds
  .map(
    (world: World) => `### ${world.name}

${world.description || ''}

**Geography:** ${world.geography || ''}
**Culture:** ${world.culture || ''}

`,
  )
  .join('\n')}

## Manuscript

${project.manuscript || 'No manuscript content yet.'}

`;

    return markdown;
  }

  private parseMarkdownProject(content: string): StoryProject {
    const lines = content.split('\n');
    let title = 'Imported Project';
    let description = '';
    let author = '';
    let manuscript = '';

    let inFrontmatter = false;
    let inManuscript = false;

    for (const line of lines) {
      if (line.trim() === '---') {
        inFrontmatter = !inFrontmatter;
        continue;
      }

      if (inFrontmatter) {
        if (line.startsWith('title:')) {
          title = line.split(':')[1]?.trim().replace(/"/g, '') ?? title;
        } else if (line.startsWith('author:')) {
          author = line.split(':')[1]?.trim().replace(/"/g, '') ?? author;
        } else if (line.startsWith('description:')) {
          description = line.split(':')[1]?.trim().replace(/"/g, '') ?? description;
        }
      } else if (line.startsWith('## Manuscript')) {
        inManuscript = true;
      } else if (inManuscript && line.startsWith('## ')) {
        inManuscript = false;
      } else if (inManuscript) {
        manuscript += `${line}\n`;
      }
    }

    const logline = description || (author ? `Imported by ${author}` : 'Imported project');
    const manuscriptSections = manuscript
      ? [{ id: 'imported-manuscript-1', title: 'Imported Manuscript', content: manuscript.trim() }]
      : [
          {
            id: 'imported-manuscript-1',
            title: 'Imported Manuscript',
            content: 'No manuscript content yet.',
          },
        ];

    return {
      title,
      logline,
      characters: [],
      worlds: [],
      manuscript: manuscriptSections,
    } as StoryProject;
  }
}

export const fileSystemService = new FileSystemService();
