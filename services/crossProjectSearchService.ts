import type { ProjectData } from '../features/project/projectSlice';
import type { Character, StorySection } from '../types';
import { normalizeSearch, scoreAgainstQuery } from './commands/fuzzyScore';
import type { ProjectSearchIndex } from './crossProjectIndexService';

export type CrossProjectSearchMatchType = 'title' | 'logline' | 'manuscript' | 'character';

export interface CrossProjectSearchResult {
  projectId: string;
  projectTitle: string;
  matchType: CrossProjectSearchMatchType;
  excerpt: string;
  score: number;
}

function extractCharacters(data: ProjectData): Character[] {
  const { characters } = data;
  if (Array.isArray(characters)) return characters;
  return (characters.ids as string[])
    .map((id) => characters.entities[id])
    .filter((c): c is Character => c !== undefined);
}

function buildExcerpt(content: string, maxLength = 120): string {
  const trimmed = content.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}…`;
}

function extractManuscriptSections(data: ProjectData): StorySection[] {
  return data.manuscript ?? [];
}

/**
 * Search within a single loaded project's Redux data.
 * Results are sorted by score descending.
 */
export function searchAcrossProjects(
  query: string,
  projectData: ProjectData,
): CrossProjectSearchResult[] {
  const queryNorm = normalizeSearch(query);
  if (!queryNorm) return [];

  const projectId = projectData.id ?? 'current';
  const projectTitle = projectData.title;
  const results: CrossProjectSearchResult[] = [];

  const titleScore = scoreAgainstQuery(queryNorm, projectTitle);
  if (titleScore > 0) {
    results.push({
      projectId,
      projectTitle,
      matchType: 'title',
      excerpt: projectTitle,
      score: titleScore,
    });
  }

  const logline = projectData.logline ?? '';
  if (logline) {
    const loglineScore = scoreAgainstQuery(queryNorm, logline);
    if (loglineScore > 0) {
      results.push({
        projectId,
        projectTitle,
        matchType: 'logline',
        excerpt: buildExcerpt(logline),
        score: loglineScore,
      });
    }
  }

  for (const section of extractManuscriptSections(projectData)) {
    const sectionScore = scoreAgainstQuery(queryNorm, section.title, section.content);
    if (sectionScore > 0) {
      const excerpt = section.content ? buildExcerpt(section.content) : section.title;
      results.push({
        projectId,
        projectTitle,
        matchType: 'manuscript',
        excerpt,
        score: sectionScore,
      });
    }
  }

  for (const character of extractCharacters(projectData)) {
    const charScore = scoreAgainstQuery(
      queryNorm,
      character.name,
      character.backstory ?? '',
      character.motivation ?? '',
    );
    if (charScore > 0) {
      results.push({
        projectId,
        projectTitle,
        matchType: 'character',
        excerpt: character.name,
        score: charScore,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Lightweight search across the privacy-preserving project index (no full project load required).
 * Phase-1 of a two-phase search: title/logline/character hits load the full project on demand.
 */
// QNBS-v3: v2 multi-project search — scans IDB index instead of in-memory Redux state.
export function searchAcrossProjectIndex(
  query: string,
  indexes: ProjectSearchIndex[],
): CrossProjectSearchResult[] {
  const queryNorm = normalizeSearch(query);
  if (!queryNorm || indexes.length === 0) return [];

  const results: CrossProjectSearchResult[] = [];

  for (const idx of indexes) {
    const titleScore = scoreAgainstQuery(queryNorm, idx.title);
    if (titleScore > 0) {
      results.push({
        projectId: idx.projectId,
        projectTitle: idx.title,
        matchType: 'title',
        excerpt: idx.title,
        score: titleScore,
      });
    }

    if (idx.logline) {
      const loglineScore = scoreAgainstQuery(queryNorm, idx.logline);
      if (loglineScore > 0) {
        results.push({
          projectId: idx.projectId,
          projectTitle: idx.title,
          matchType: 'logline',
          excerpt: buildExcerpt(idx.logline),
          score: loglineScore,
        });
      }
    }

    for (const name of idx.characterNames) {
      const charScore = scoreAgainstQuery(queryNorm, name);
      if (charScore > 0) {
        results.push({
          projectId: idx.projectId,
          projectTitle: idx.title,
          matchType: 'character',
          excerpt: name,
          score: charScore,
        });
        break;
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
