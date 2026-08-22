import type { StoryProject } from '../types';

export interface ScenarioWorkspaceProjection {
  title: string;
  logline: string;
  counts: {
    characters: number;
    worlds: number;
    outline: number;
    scenes: number;
    words: number;
  };
  sections: Array<{ id: string; title: string; summary: string }>;
}

const countEntities = <T,>(value: T[] | { ids: string[] }): number =>
  Array.isArray(value) ? value.length : value.ids.length;

export function buildScenarioWorkspaceProjection(project: StoryProject): ScenarioWorkspaceProjection {
  // QNBS-v3: project views derive from canonical StoryProject state so screenplay planning cannot drift from manuscript data.
  const sections = project.manuscript.map((section) => ({
    id: section.id,
    title: section.title,
    summary: section.summary ?? section.notes ?? '',
  }));
  const words = project.manuscript.reduce(
    (total, section) => total + section.content.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return {
    title: project.title,
    logline: project.logline,
    counts: {
      characters: countEntities(project.characters),
      worlds: countEntities(project.worlds),
      outline: project.outline?.length ?? 0,
      scenes: sections.length,
      words,
    },
    sections,
  };
}