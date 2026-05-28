/**
 * FsProjectStore — Project CRUD + import/export on the filesystem.
 * ENCRYPTION: plaintext — manuscript data; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from fileSystemService.ts. saveProject triggers auto-snapshot via FsSnapshotStore.
 */

import type { EntityState } from '@reduxjs/toolkit';
import type { Character, StoryProject, World } from '../../types';
import { logger } from '../logger';
import { parseImportedProjectJson } from '../projectImportSchema';
import { normalizeSaveProjectInputToStoryProject, type SaveProjectInput } from '../storageBackend';
import { FsAssetStore } from './assetFsStore';
import { compressData, decompressData, retryFs, sanitizePathSegment } from './fsCore';

export class FsProjectStore extends FsAssetStore {
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
      ((flat as unknown as Record<string, unknown>)['id'] as string) || flat.title || 'project',
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
      const parsed = parseImportedProjectJson(content);
      type CharRow = Character & { avatarBase64?: string };
      type WorldRow = World & { ambianceImageBase64?: string };
      let characterArray: CharRow[] = [];
      if (Array.isArray(parsed.characters)) {
        characterArray = parsed.characters as CharRow[];
      } else if (parsed.characters && 'ids' in parsed.characters) {
        const { ids, entities } = parsed.characters;
        characterArray = ids
          .map((id: string) => entities[id])
          .filter((item): item is CharRow => Boolean(item));
      }
      const charactersOut: Character[] = [];
      for (const char of characterArray) {
        const row = { ...char };
        if (row.avatarBase64) {
          await this.saveImage(row.id, row.avatarBase64);
          row.hasAvatar = true;
          delete row.avatarBase64;
        }
        charactersOut.push(row);
      }

      let worldArray: WorldRow[] = [];
      if (Array.isArray(parsed.worlds)) {
        worldArray = parsed.worlds as WorldRow[];
      } else if (parsed.worlds && 'ids' in parsed.worlds) {
        const { ids, entities } = parsed.worlds;
        worldArray = ids
          .map((id: string) => entities[id])
          .filter((item): item is WorldRow => Boolean(item));
      }
      const worldsOut: World[] = [];
      for (const world of worldArray) {
        const row = { ...world };
        if (row.ambianceImageBase64) {
          await this.saveImage(row.id, row.ambianceImageBase64);
          row.hasAmbianceImage = true;
          delete row.ambianceImageBase64;
        }
        worldsOut.push(row);
      }

      return {
        title: parsed.title,
        logline: parsed.logline,
        characters: charactersOut,
        worlds: worldsOut,
        outline: parsed.outline,
        manuscript: parsed.manuscript ?? [],
        binderNodes: parsed.binderNodes,
        projectGoals: parsed.projectGoals,
        writingHistory: parsed.writingHistory,
        // QNBS-v3: Parse-Ergebnis angleichen — Zod optional vs. StoryProject exactOptionalPropertyTypes.
      } as StoryProject;
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
