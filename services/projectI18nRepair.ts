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

// QNBS-v3: missing metadata is repairable while empty strings remain valid user intent.
function shouldRepairMetadata(value: unknown, seedInitialMetadata: boolean): boolean {
  if (typeof value !== 'string') return true;
  return (seedInitialMetadata && value === '') || isKnownPersistedTranslationKey(value);
}

/** Repair raw i18n keys, optionally seeding metadata only for the first fresh-user bootstrap. */
export function repairProjectI18nFields(
  project: ProjectMetaSlice,
  t: TranslateFn,
  { seedInitialMetadata = false }: { seedInitialMetadata?: boolean } = {},
): ProjectI18nRepair | null {
  const repair: ProjectI18nRepair = {};
  let changed = false;

  // QNBS-v3: only explicit fresh-project authority may fill blanks; raw persisted keys remain independently repairable.
  if (shouldRepairMetadata(project.title, seedInitialMetadata)) {
    repair.title = t('initialProject.title');
    changed = true;
  }
  if (shouldRepairMetadata(project.logline, seedInitialMetadata)) {
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
