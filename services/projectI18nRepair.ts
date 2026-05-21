import type { StorySection } from '../types';
import { isKnownPersistedTranslationKey } from './i18nBootstrap';

export type TranslateFn = (key: string) => string;

export type ProjectMetaSlice = {
  title: string;
  logline: string;
  manuscript: StorySection[];
};

export type ProjectI18nRepair = {
  title?: string;
  logline?: string;
  manuscript?: StorySection[];
};

/** Repair project fields that were saved as raw i18n keys during cold start. */
export function repairProjectI18nFields(
  project: ProjectMetaSlice,
  t: TranslateFn,
): ProjectI18nRepair | null {
  const repair: ProjectI18nRepair = {};
  let changed = false;

  if (!project.title || isKnownPersistedTranslationKey(project.title)) {
    repair.title = t('initialProject.title');
    changed = true;
  }
  if (!project.logline || isKnownPersistedTranslationKey(project.logline)) {
    repair.logline = t('initialProject.logline');
    changed = true;
  }

  if (project.manuscript.length === 0) {
    repair.manuscript = [
      {
        id: `sec-${Date.now()}`,
        title: t('initialProject.chapter1'),
        content: '',
      },
    ];
    changed = true;
  } else {
    const manuscript = project.manuscript.map((section) => {
      if (!isKnownPersistedTranslationKey(section.title)) return section;
      changed = true;
      return { ...section, title: t('initialProject.chapter1') };
    });
    if (manuscript.some((s, i) => s !== project.manuscript[i])) {
      repair.manuscript = manuscript;
    }
  }

  return changed ? repair : null;
}
