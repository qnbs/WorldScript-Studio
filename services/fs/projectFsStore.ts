/**
 * FsProjectStore — Project CRUD + import/export on the filesystem.
 * ENCRYPTION: plaintext — manuscript data; at-rest encryption planned for Phase 2 (P2-1).
 * QNBS-v3: Extracted from fileSystemService.ts. saveProject triggers auto-snapshot via FsSnapshotStore.
 */

import type { EntityState } from '@reduxjs/toolkit';
import { scheduleCoreProjectValidation } from '../../features/project/coreValidationShadow';
import type { Character, StoryProject, World } from '../../types';
import { getStaticTranslation } from '../i18n/staticTranslate';
import { logger } from '../logger';
import { parseImportedProjectJson } from '../projectImportSchema';
import {
  normalizeSaveProjectInputToStoryProject,
  type ProjectQuarantineResult,
  type SaveProjectInput,
} from '../storageBackend';
import { FsAssetStore } from './assetFsStore';
import {
  compressData,
  decompressData,
  retryFs,
  sanitizePathSegment,
  writeTextFileAtomic,
} from './fsCore';

// QNBS-v3 (DA-01): distinguishes corrupt/unreadable saved data from genuine absence — callers must never treat this the same as "no project exists yet".
export class ProjectLoadError extends Error {
  constructor(
    public readonly reason: 'corrupt' | 'io-error',
    message: string,
    public readonly projectId: string,
  ) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

// QNBS-v3 (CodeAnt/CodeRabbit): array-or-EntityState — characters/worlds may be either shape in a real saved project.
function isArrayOrEntityState(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)['ids']) &&
    typeof (value as Record<string, unknown>)['entities'] === 'object'
  );
}

// QNBS-v3 (DA-01): rejects parsed JSON that isn't project-shaped at all (e.g. an unrelated file, or a prior empty-object substitution bug) instead of silently hydrating a near-blank project.
function looksLikeStoryProject(value: unknown): value is StoryProject {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['title'] === 'string' &&
    typeof v['logline'] === 'string' &&
    Array.isArray(v['manuscript']) &&
    isArrayOrEntityState(v['characters']) &&
    isArrayOrEntityState(v['worlds'])
  );
}

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
    await writeTextFileAtomic(apis, projectFile, compressData(flat));
    // QNBS-v3 (#332): documented best-effort abort — the project data above already saved; a failed marker write only degrades the next cold-boot's project selection, not worth failing this save over.
    await this.setActiveProjectId(projectId).catch((error) => {
      logger.warn('Failed to persist active-project marker (project save itself succeeded)', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /** QNBS-v3 (#332): marker file recording the last-saved project ID, read back at cold boot. */
  private async setActiveProjectId(projectId: string): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');
    if (!(await apis.exists(configPath))) {
      await apis.mkdir(configPath, { recursive: true });
    }
    const markerFile = await apis.join(configPath, 'active-project-id.txt');
    await writeTextFileAtomic(apis, markerFile, projectId);
  }

  /**
   * The last-saved project's ID, or null if no marker exists yet (fresh install, or one that
   * predates this marker — callers should fall back to a deterministic choice among
   * `listProjects()`'s results, not assume null means no projects exist).
   */
  async getActiveProjectId(): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const markerFile = await apis.join(appDataPath, 'config', 'active-project-id.txt');
      if (!(await apis.exists(markerFile))) return null;
      const id = (await retryFs(() => apis.readTextFile(markerFile))).trim();
      return id || null;
    } catch (error) {
      logger.error('Failed to read active project marker:', error);
      return null;
    }
  }

  /**
   * Genuine absence (no saved file for this ID) resolves to `null` — legitimate and unchanged.
   * A corrupt or unreadable file throws `ProjectLoadError` instead: DA-01 requires that this never
   * collapse into the same `null` a caller would read as "no project exists yet".
   */
  async loadProject(projectId: string): Promise<StoryProject | null> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeProjectId = sanitizePathSegment(projectId);
    const projectFile = await apis.join(appDataPath, 'projects', safeProjectId, 'project.json');

    // QNBS-v3 (CodeRabbit/codex): exists() rejecting is an I/O failure too, not absence — classify it the same as a readTextFile failure rather than letting it escape raw.
    let content: string;
    try {
      if (!(await apis.exists(projectFile))) {
        return null;
      }
      content = await retryFs(() => apis.readTextFile(projectFile));
    } catch (error) {
      logger.error('Failed to read project file (I/O error):', error);
      throw new ProjectLoadError(
        'io-error',
        `Could not read the project file for "${projectId}" — it may be locked, permission-denied, or otherwise inaccessible.`,
        projectId,
      );
    }

    let project: StoryProject;
    try {
      const parsed = decompressData<unknown>(content);
      if (!looksLikeStoryProject(parsed)) {
        throw new Error('Parsed content is not project-shaped (missing title/manuscript).');
      }
      project = parsed;
    } catch (error) {
      logger.error('Failed to parse project file (corrupt data):', error);
      throw new ProjectLoadError(
        'corrupt',
        `The saved project file for "${projectId}" appears to be corrupted and could not be read. The file has not been deleted.`,
        projectId,
      );
    }

    // QNBS-v3: schedule observation after this async load resolves so validation cannot delay or alter the load result.
    scheduleCoreProjectValidation(project);
    return project;
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

  /** Move the whole corrupt project directory aside so its manuscript and assets remain recoverable. */
  async quarantineProject(projectId: string): Promise<ProjectQuarantineResult> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const safeProjectId = sanitizePathSegment(projectId, 'project');
    const projectPath = await apis.join(appDataPath, 'projects', safeProjectId);
    if (!(await apis.exists(projectPath))) {
      throw new Error(`Could not quarantine project "${projectId}": project directory not found.`);
    }

    const quarantineRoot = await apis.join(appDataPath, 'quarantined-projects');
    await apis.mkdir(quarantineRoot, { recursive: true });
    const timestamp = Date.now();
    for (let attempt = 0; attempt < 100; attempt++) {
      const suffix = attempt === 0 ? String(timestamp) : `${timestamp}-${attempt}`;
      const quarantinePath = await apis.join(quarantineRoot, `${safeProjectId}-corrupt-${suffix}`);
      if (await apis.exists(quarantinePath)) continue;
      await retryFs(() => apis.rename(projectPath, quarantinePath));
      return { projectId, path: quarantinePath };
    }

    throw new Error(`Could not quarantine project "${projectId}": recovery target already exists.`);
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
    const fileName = project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    // QNBS-v3 (DA-05): real DOCX via apis.writeFile (binary) — Packer.toBuffer needs Node's Buffer, unavailable in the Tauri WebView, so use the browser-safe toArrayBuffer path instead.
    if (format === 'docx') {
      const { Packer } = await import('docx');
      const { buildDocxDocument } = await import('../export/docxDocumentBuilder');
      const [loglineLabel, manuscriptHeading] = await Promise.all([
        getStaticTranslation('export.loglineLabel'),
        getStaticTranslation('export.manuscriptLabel'),
      ]);
      const doc = buildDocxDocument({
        title: project.title,
        loglineLabel,
        logline: project.logline,
        manuscript: { heading: manuscriptHeading, sections: project.manuscript },
      });
      const arrayBuffer = await Packer.toArrayBuffer(doc);
      const filePath = await apis.save({
        defaultPath: `${fileName}.docx`,
        filters: [{ name: 'DOCX', extensions: ['docx'] }],
      });
      if (filePath) {
        await retryFs(() => apis.writeFile(filePath, new Uint8Array(arrayBuffer)));
      }
      return;
    }

    let content: string;
    let extension: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(project, null, 2);
        extension = 'json';
        break;
      case 'markdown':
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
