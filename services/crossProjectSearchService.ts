// QNBS-v3: v1 scope — single-project search only; multi-project requires DB_VERSION bump + IDB migration
import type { ProjectData } from '../features/project/projectSlice';
import type { Character, StorySection } from '../types';
import { normalizeSearch, scoreAgainstQuery } from './commands/fuzzyScore';

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
