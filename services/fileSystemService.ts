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

import type { StoryProject, Settings, Character, World } from '../types';
import type { EntityState } from '@reduxjs/toolkit';

import type { StorageBackend } from './storageService';

class FileSystemService implements StorageBackend {
  private appDataPath: string | null = null;

  async initialize(): Promise<void> {
    try {
      const apis = await loadTauriApis();
      this.appDataPath = await apis.appDataDir();
    } catch (error) {
      console.error('Failed to get app data directory:', error);
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
  async saveProject(project: StoryProject): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const projectPath = await apis.join(
      appDataPath,
      'projects',
      ((project as unknown as Record<string, unknown>).id as string) || project.title
    );

    // Ensure project directory exists
    if (!(await apis.exists(projectPath))) {
      await apis.mkdir(projectPath, { recursive: true });
    }

    const projectFile = await apis.join(projectPath, 'project.json');
    await apis.writeTextFile(projectFile, JSON.stringify(project, null, 2));
  }

  async loadProject(projectId: string): Promise<StoryProject | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const projectFile = await apis.join(appDataPath, 'projects', projectId, 'project.json');

      if (!(await apis.exists(projectFile))) {
        return null;
      }

      const content = await apis.readTextFile(projectFile);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load project:', error);
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

      const entries = await apis.readDir(projectsPath);
      return entries.filter((entry) => entry.name).map((entry) => entry.name as string);
    } catch (error) {
      console.error('Failed to list projects:', error);
      return [];
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const projectPath = await apis.join(appDataPath, 'projects', projectId);

    // For simplicity, we'll just remove the project.json file
    if (await apis.exists(projectPath)) {
      await apis.remove(projectPath, { recursive: true });
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

    const imageFile = await apis.join(imagesPath, `${id}.png`);
    // Remove data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/png;base64,/, '');
    await apis.writeTextFile(imageFile, cleanBase64);
  }

  async getImage(id: string): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const imageFile = await apis.join(appDataPath, 'images', `${id}.png`);

      if (!(await apis.exists(imageFile))) {
        return null;
      }

      const base64Data = await apis.readTextFile(imageFile);
      return `data:image/png;base64,${base64Data}`;
    } catch (error) {
      console.error('Failed to load image:', error);
      return null;
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
    await apis.writeTextFile(settingsFile, JSON.stringify(settings, null, 2));
  }

  async loadSettings(): Promise<Settings | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const settingsFile = await apis.join(appDataPath, 'config', 'settings.json');

      if (!(await apis.exists(settingsFile))) {
        return null;
      }

      const content = await apis.readTextFile(settingsFile);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load settings:', error);
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

  // Generic provider API key — stored as plaintext in app data dir (Tauri is sandboxed)
  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    const apis = await this.getApis();
    const configPath = await apis.join(await this.ensureAppDataPath(), 'config');
    if (!(await apis.exists(configPath))) await apis.mkdir(configPath, { recursive: true });
    await apis.writeTextFile(await apis.join(configPath, `${provider}_key.txt`), apiKey);
  }

  async getApiKey(provider: string): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const keyFile = await apis.join(
        await this.ensureAppDataPath(),
        'config',
        `${provider}_key.txt`
      );
      if (!(await apis.exists(keyFile))) return null;
      return await apis.readTextFile(keyFile);
    } catch {
      return null;
    }
  }

  async clearApiKey(provider: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const keyFile = await apis.join(
        await this.ensureAppDataPath(),
        'config',
        `${provider}_key.txt`
      );
      if (await apis.exists(keyFile)) await apis.remove(keyFile);
    } catch {
      /* ignore */
    }
  }

  // Snapshot operations
  async saveSnapshot(snapshotId: string, data: unknown): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const snapshotsPath = await apis.join(appDataPath, 'snapshots');

    if (!(await apis.exists(snapshotsPath))) {
      await apis.mkdir(snapshotsPath, { recursive: true });
    }

    const snapshotFile = await apis.join(snapshotsPath, `${snapshotId}.json`);
    await apis.writeTextFile(snapshotFile, JSON.stringify(data, null, 2));
  }

  async getSnapshotData(snapshotId: string): Promise<unknown> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotFile = await apis.join(appDataPath, 'snapshots', `${snapshotId}.json`);

      if (!(await apis.exists(snapshotFile))) {
        return null;
      }

      const content = await apis.readTextFile(snapshotFile);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      return null;
    }
  }

  async listSnapshots(): Promise<string[]> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotsPath = await apis.join(appDataPath, 'snapshots');

      if (!(await apis.exists(snapshotsPath))) {
        return [];
      }

      const entries = await apis.readDir(snapshotsPath);
      return entries
        .filter((entry) => entry.name?.endsWith('.json'))
        .map((entry) => entry.name!.replace('.json', ''));
    } catch (error) {
      console.error('Failed to list snapshots:', error);
      return [];
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const snapshotFile = await apis.join(appDataPath, 'snapshots', `${snapshotId}.json`);

      if (await apis.exists(snapshotFile)) {
        await apis.remove(snapshotFile);
      }
    } catch (error) {
      console.error('Failed to delete snapshot:', error);
    }
  }

  // Import/Export functionality
  async exportProject(
    project: StoryProject,
    format: 'json' | 'markdown' | 'docx' = 'json'
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
        // For docx, we'll save as markdown for now and handle conversion later
        fileName = `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
        content = this.convertToMarkdown(project);
        extension = 'md';
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const filePath = await apis.save({
      defaultPath: `${fileName}.${extension}`,
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [extension],
        },
      ],
    });

    if (filePath) {
      await apis.writeTextFile(filePath, content);
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

    const content = await apis.readTextFile(filePath);

    if (filePath.endsWith('.json')) {
      return JSON.parse(content);
    } else if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
      return this.parseMarkdownProject(content);
    }

    throw new Error('Unsupported file format');
  }

  private convertToMarkdown(project: StoryProject): string {
    const p = project as unknown as Record<string, unknown>;
    const characters = Array.isArray(project.characters)
      ? project.characters
      : (Object.values((project.characters as EntityState<Character, string>).entities).filter(
          Boolean
        ) as Character[]);
    const worlds = Array.isArray(project.worlds)
      ? project.worlds
      : (Object.values((project.worlds as EntityState<World, string>).entities).filter(
          Boolean
        ) as World[]);
    const markdown = `---
title: "${project.title}"
author: "${(p.author as string) || ''}"
description: "${(p.description as string) || ''}"
created: "${(p.createdAt as string) || ''}"
updated: "${(p.updatedAt as string) || ''}"
---

# ${project.title}

${(p.description as string) || ''}

## Characters

${characters
  .map(
    (char: Character) => `### ${char.name}

${char.backstory || ''}

**Personality:** ${char.personalityTraits || ''}
**Motivation:** ${char.motivation || ''}
**Appearance:** ${char.appearance || ''}

`
  )
  .join('\n')}

## Worlds

${worlds
  .map(
    (world: World) => `### ${world.name}

${world.description || ''}

**Geography:** ${world.geography || ''}
**Culture:** ${world.culture || ''}

`
  )
  .join('\n')}

## Manuscript

${project.manuscript || 'No manuscript content yet.'}

`;

    return markdown;
  }

  private parseMarkdownProject(content: string): StoryProject {
    // Simple markdown parser - in a real implementation, you'd use a proper markdown parser
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
          title = line.split(':')[1].trim().replace(/"/g, '');
        } else if (line.startsWith('author:')) {
          author = line.split(':')[1].trim().replace(/"/g, '');
        } else if (line.startsWith('description:')) {
          description = line.split(':')[1].trim().replace(/"/g, '');
        }
      } else if (line.startsWith('## Manuscript')) {
        inManuscript = true;
      } else if (inManuscript && line.startsWith('## ')) {
        inManuscript = false;
      } else if (inManuscript) {
        manuscript += line + '\n';
      }
    }

    return {
      title,
      logline: description,
      characters: [],
      worlds: [],
      manuscript: [],
    } as StoryProject;
  }
}

export const fileSystemService = new FileSystemService();
